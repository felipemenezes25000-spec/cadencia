// packages/scheduling/src/recorrencia.ts

/**
 * Expansão de agendamento recorrente — fisioterapia toda terça, retorno mensal.
 *
 * TRABALHA EM HORA DE PAREDE, não em instante. "Toda terça as 14h" é um
 * compromisso com o relógio da clínica: se o país reinstituir horário de verão
 * no meio da série, o paciente continua marcado para as 14h. Expandir em UTC e
 * converter no fim faria o horário ANDAR uma hora a partir da virada, e ninguém
 * perceberia até alguém chegar na hora errada.
 *
 * A conversão para instante fica no Postgres (`(data||' '||hora)::timestamp AT
 * TIME ZONE tz`), que conhece as regras de cada fuso e as mudanças históricas
 * delas. Aqui só se conta dia de calendário — e por isso a função é PURA, sem
 * `Date` de relógio e sem fuso nenhum.
 */

export type FrequenciaRecorrencia = 'diaria' | 'semanal' | 'quinzenal' | 'mensal';

export interface EntradaDaRecorrencia {
  /** Data da primeira ocorrência, 'AAAA-MM-DD'. Define o dia da semana e do mês. */
  readonly primeiraData: string;
  /** Hora de parede, 'HH:MM'. */
  readonly hora: string;
  readonly freq: FrequenciaRecorrencia;
  /** Multiplicador: 2 semanal = a cada duas semanas. */
  readonly intervalo: number;
  /** Último dia que pode receber ocorrência. INCLUSIVO. */
  readonly horizonteAte: string;
}

/**
 * Teto de ocorrências por série.
 *
 * Diária por três anos são mais de mil linhas em `sched.appointment`, cada uma
 * disputando o índice de exclusão por sobreposição. O limite protege o banco de
 * um clique distraído — 200 cobre "toda semana por quatro anos" com folga.
 */
const MAXIMO_DE_OCORRENCIAS = 200;

/** Dias no mês, sem depender do relógio. Fevereiro segue a regra gregoriana. */
function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** Número de dias desde uma época arbitrária — serve só para comparar datas. */
function ordinal(ano: number, mes: number, dia: number): number {
  // Algoritmo de dias julianos simplificado: monotônico, que é tudo que a
  // comparação precisa. Evita `Date`, que traria fuso para dentro de uma função
  // que existe justamente para não ter fuso.
  const a = Math.floor((14 - mes) / 12);
  const y = ano + 4800 - a;
  const m = mes + 12 * a - 3;
  return dia + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function partes(data: string): [number, number, number] {
  const [a, m, d] = data.split('-').map(Number);
  return [a ?? 0, m ?? 0, d ?? 0];
}

function formatar(ano: number, mes: number, dia: number, hora: string): string {
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${ano}-${mm}-${dd}T${hora}`;
}

/** Soma dias a uma data de calendário, virando mês e ano quando preciso. */
function somarDias(ano: number, mes: number, dia: number, n: number): [number, number, number] {
  let [a, m, d] = [ano, mes, dia + n];
  for (;;) {
    const limite = diasNoMes(a, m);
    if (d <= limite) break;
    d -= limite;
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return [a, m, d];
}

export function expandirRecorrencia(e: EntradaDaRecorrencia): string[] {
  const [ano0, mes0, dia0] = partes(e.primeiraData);
  const fim = ordinal(...partes(e.horizonteAte));

  const passoEmDias =
    e.freq === 'diaria' ? e.intervalo
      : e.freq === 'semanal' ? 7 * e.intervalo
        // Quinzenal é de 14 em 14 dias, não "de 15 em 15": 15 trocaria terça por
        // quarta na segunda ocorrência, e a agenda deixaria de bater com a
        // rotina do profissional.
        : e.freq === 'quinzenal' ? 14 * e.intervalo
          : 0;

  const datas: string[] = [];
  let a = ano0;
  let m = mes0;
  let d = dia0;
  let n = 0;

  for (;;) {
    datas.push(formatar(a, m, d, e.hora));
    n += 1;
    if (n > MAXIMO_DE_OCORRENCIAS) {
      throw new Error(
        `serie passa do limite de ${MAXIMO_DE_OCORRENCIAS} ocorrencias; reduza o horizonte`);
    }

    if (passoEmDias > 0) {
      [a, m, d] = somarDias(a, m, d, passoEmDias);
    } else {
      // Mensal: anda o MÊS e reancora no dia pedido. Aparar para 28 e arrastar
      // o resto da série transformaria "todo dia 31" em "todo dia 28" a partir
      // de fevereiro — o dia original tem de continuar sendo a referência.
      m += e.intervalo;
      while (m > 12) { m -= 12; a += 1; }
      d = Math.min(dia0, diasNoMes(a, m));
    }

    if (ordinal(a, m, d) > fim) break;
  }

  return datas;
}
