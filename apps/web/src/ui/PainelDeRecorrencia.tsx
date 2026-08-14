// apps/web/src/ui/PainelDeRecorrencia.tsx
'use client';

import { useState } from 'react';
import { ArrowsClockwise, Warning } from '@phosphor-icons/react';
// Subpath, não o barrel: `@cadencia/scheduling` reexporta appointments, check-in,
// day, needs-you e criar-recorrencia, e todos esses pedem `TxClient` do
// `@cadencia/db` e `uuidv7` do kernel — que abre `node:crypto`. Importar o barrel
// aqui arrasta o pacote de banco inteiro para dentro do bundle do navegador e o
// `next build` quebra em "Reading from node:crypto is not handled by plugins".
// `recorrencia.ts` não importa nada: é a única peça de agenda segura no browser.
import { expandirRecorrencia, type FrequenciaRecorrencia } from '@cadencia/scheduling/recorrencia';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';

export interface ProcedimentoOpcao {
  readonly id: string;
  readonly nome: string;
  readonly duracaoMin: number;
}

export interface NovaRecorrencia {
  readonly procedureId: string;
  /** 'AAAA-MM-DD' no fuso da clínica. */
  readonly primeiraData: string;
  /** 'HH:MM' de parede. */
  readonly hora: string;
  readonly freq: FrequenciaRecorrencia;
  readonly intervalo: number;
  readonly horizonteAte: string;
}

export interface ResultadoDaSerie {
  readonly criadas: readonly { quando: string; appointmentId: string }[];
  readonly recusadas: readonly {
    quando: string;
    motivo: 'horario_ocupado' | 'sala_ocupada' | 'erro';
  }[];
}

export interface PainelDeRecorrenciaProps {
  readonly aberto: boolean;
  /** Data da primeira ocorrência — define o dia da semana e do mês da série. */
  readonly dia: string;
  readonly pacienteNome: string;
  readonly procedimentos: readonly ProcedimentoOpcao[];
  readonly aoCriar: (r: NovaRecorrencia) => Promise<ResultadoDaSerie>;
  readonly aoFechar: () => void;
}

const FREQUENCIAS: readonly { id: FrequenciaRecorrencia; rotulo: string }[] = [
  { id: 'semanal', rotulo: 'Toda semana' },
  { id: 'quinzenal', rotulo: 'A cada 15 dias' },
  { id: 'mensal', rotulo: 'Todo mês' },
  { id: 'diaria', rotulo: 'Todo dia' },
];

const MOTIVO: Record<string, string> = {
  horario_ocupado: 'horário ocupado',
  sala_ocupada: 'sala ocupada',
  erro: 'falha ao agendar',
};

/** 'AAAA-MM-DDTHH:MM' -> '09/03', sem passar por Date (e sem fuso junto). */
function diaCurto(parede: string): string {
  return `${parede.slice(8, 10)}/${parede.slice(5, 7)}`;
}

/**
 * Agendamento recorrente — fisioterapia toda terça, retorno mensal.
 *
 * O painel entrega DATA e HORA separadas, nunca um instante: "toda terça às
 * 14h" é um compromisso com o relógio da clínica, e quem está olhando pode
 * estar em outro estado. Quem converte para instante é o Postgres, com o fuso
 * da unidade.
 *
 * A prévia usa a MESMA função de expansão que o servidor (`expandirRecorrencia`,
 * de `@cadencia/scheduling`). Reimplementar a contagem aqui criaria duas
 * verdades sobre quantas consultas a série gera, e elas divergiriam no primeiro
 * mês de 31 dias.
 */
export function PainelDeRecorrencia(p: PainelDeRecorrenciaProps) {
  // Começa VAZIO e cai no primeiro procedimento quando a lista chega.
  //
  // `useState(p.procedimentos[0]?.id)` só roda o inicializador uma vez: o painel
  // abre antes de a lista carregar, o estado nasce '' e NUNCA se corrige — o
  // select mostra as opções e o botão fica travado para sempre. Derivar em vez
  // de guardar resolve sem efeito colateral.
  const [escolhido, setProcedureId] = useState('');
  const procedureId = escolhido !== '' ? escolhido : (p.procedimentos[0]?.id ?? '');
  const [freq, setFreq] = useState<FrequenciaRecorrencia>('semanal');
  const [hora, setHora] = useState('');
  const [horizonteAte, setHorizonteAte] = useState('');
  const [criando, setCriando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaSerie | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  let previa = 0;
  let excedeLimite = false;
  if (hora !== '' && horizonteAte !== '' && horizonteAte >= p.dia) {
    try {
      previa = expandirRecorrencia({
        primeiraData: p.dia, hora, freq, intervalo: 1, horizonteAte,
      }).length;
    } catch {
      // O servidor recusaria de qualquer forma; avisar aqui evita a viagem e,
      // principalmente, evita a recepção combinar com o paciente algo que não
      // vai acontecer.
      excedeLimite = true;
    }
  }

  const incompleto = hora === '' || horizonteAte === '' || procedureId === ''
    || excedeLimite || previa === 0;

  async function criar(): Promise<void> {
    setErro(null);
    setCriando(true);
    try {
      setResultado(await p.aoCriar({
        procedureId, primeiraData: p.dia, hora, freq, intervalo: 1, horizonteAte,
      }));
    } catch {
      setErro('Não foi possível criar a série. Nada foi marcado.');
    } finally {
      setCriando(false);
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Repetir consulta" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <p className="text-sm text-text-muted">
          Série para <strong className="text-text">{p.pacienteNome}</strong>,
          a partir de {diaCurto(`${p.dia}T00:00`)}.
        </p>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Procedimento</span>
          <select
            value={procedureId}
            onChange={(e) => setProcedureId(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
          >
            {p.procedimentos.map((x) => (
              <option key={x.id} value={x.id}>{x.nome} ({x.duracaoMin} min)</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Frequência</span>
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value as FrequenciaRecorrencia)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              {FREQUENCIAS.map((f) => (
                <option key={f.id} value={f.id}>{f.rotulo}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Hora</span>
            <input
              type="time" value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            />
          </label>
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Repetir até</span>
          <input
            type="date" value={horizonteAte} min={p.dia}
            onChange={(e) => setHorizonteAte(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
          />
          <span className="text-xs text-text-muted">
            Série sem fim marcaria consulta para sempre. Este é o combinado com
            o paciente — "doze sessões, até o fim de março".
          </span>
        </label>

        {excedeLimite && (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--r-sm)] border border-danger/40 bg-danger/5 p-3 text-sm text-text">
            <Warning size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            <span>Essa combinação passa do limite de 200 consultas. Aproxime a data final.</span>
          </p>
        )}

        {previa > 0 && !excedeLimite && (
          <p className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm text-text">
            Vai marcar <strong>{previa} consultas</strong>.
          </p>
        )}

        {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

        <Botao
          iconeEsquerda={ArrowsClockwise}
          disabled={incompleto}
          carregando={criando}
          onClick={() => { void criar(); }}
        >
          Criar série
        </Botao>

        {resultado !== null && (
          <section className="grid gap-2">
            <p className="text-sm font-medium text-ok">
              {resultado.criadas.length} consultas marcadas.
            </p>
            {resultado.recusadas.length > 0 && (
              <div className="grid gap-1">
                {/* Recusar em silêncio deixaria o paciente achando que tem
                    consulta num dia em que não tem. Cada dia aparece. */}
                <p className="text-sm text-text">
                  Estes dias ficaram de fora — remarque um a um:
                </p>
                <ul className="grid gap-1 text-sm">
                  {resultado.recusadas.map((x) => (
                    <li key={x.quando}
                      className="flex items-center justify-between rounded-[var(--r-sm)] border border-warn/40 bg-warn/5 px-3 py-1.5">
                      <span className="font-medium text-text">{diaCurto(x.quando)}</span>
                      <span className="text-xs text-text-muted">{MOTIVO[x.motivo]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </PainelLateral>
  );
}
