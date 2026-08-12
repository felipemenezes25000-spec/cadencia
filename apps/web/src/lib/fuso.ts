// apps/web/src/lib/fuso.ts

/**
 * Conversão de instante para hora de parede DA CLÍNICA.
 *
 * A API devolve todo carimbo em UTC — `to_char(... AT TIME ZONE 'UTC', ...'Z')`.
 * Isso é uma boa decisão no servidor: instante é instante, e o fuso é assunto de
 * apresentação. Mas obriga a tela a converter, e o atalho de fatiar a string ISO
 * (`iso.slice(0, 10)`) devolve a data em UTC, não a da clínica.
 *
 * No Brasil, UTC-3: toda consulta a partir das 21h já está no DIA SEGUINTE em
 * UTC. Uma consulta de sexta às 21h30 aparecia na coluna de sábado da visão
 * semana, e a tela Hoje virava de dia três horas antes da meia-noite — às 21h a
 * recepção perdia de vista as consultas que ainda faltavam atender.
 *
 * O fuso vem da UNIDADE, não do navegador: a secretária pode estar em São Paulo
 * operando a agenda de Manaus, e quem manda é onde o paciente vai ser atendido.
 */

/** Data de calendário no fuso da clínica, 'AAAA-MM-DD'. */
export function diaNaClinica(iso: string, fuso: string): string {
  // 'en-CA' formata como AAAA-MM-DD, que é exatamente o formato ISO de data e
  // dispensa remontar a string a partir de partes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** Hora de parede no fuso da clínica, 'HH:MM' em 24 horas. */
export function horaNaClinica(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/**
 * Não existe `hojeNaClinica()` aqui de propósito.
 *
 * Este módulo é PURO: converte instante para hora de parede e nada mais. Ler o
 * relógio dentro dele quebraria o lint de fonte de tempo
 * (`tools/repo/time-source.ts`), que reserva a leitura do relógio do sistema a
 * `kernel/clock.ts` e `kernel/uuid.ts` — a regra existe para que carimbo
 * persistido venha sempre do Postgres.
 *
 * Para "hoje na clínica", a tela passa o instante atual para `diaNaClinica`. A
 * leitura do relógio fica onde ela é legítima: apresentação, no componente,
 * sobre um valor que nunca é gravado. O lint varre apenas `.ts`, e o scanner é
 * uma varredura por linha — nem o código NEM O COMENTÁRIO deste arquivo podem
 * conter a construção proibida.
 */
