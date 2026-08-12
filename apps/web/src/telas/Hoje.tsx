'use client';

import { useEffect, useState } from 'react';
import {
  CalendarBlank,
  ChatCircle,
  CurrencyDollar,
  FileText,
  NotePencil,
  PencilSimple,
  Plus,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { PageHeader } from '../ui/PageHeader';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';
import { Icone } from '../ui/Icone';
import type { StatusAgenda } from '../ui/ChipDeStatus';
import { horaNaClinica } from '../lib/fuso';

export interface LinhaDaFila {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly professionalId: string;
  readonly professionalNome?: string;
  readonly procedureNome: string | null;
  readonly procedureCor: string | null;
  readonly operadoraNome: string | null;
  readonly status: StatusAgenda;
  readonly encaixe: boolean;
  readonly teleconsulta: boolean;
  readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean;
  readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;
  readonly mensagensNaoLidas: number;
  readonly pagamentoPendente: boolean;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number;
  readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number;
  readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  /** Fuso da UNIDADE. Os carimbos chegam em UTC e são exibidos neste fuso. */
  readonly timezone: string;
  readonly filtro?: FiltroDoDia;
  readonly mensagensNaoLidasTotal: number;
  readonly carregarDia: (
    dia: string,
    filtro?: FiltroDoDia,
  ) => Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
  readonly aoMensagem: (linha: LinhaDaFila) => void;
  readonly aoCobrar: (linha: LinhaDaFila) => void;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string, PhosphorIcon, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta', ChatCircle, 'Converse antes que virem faltas'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas', PencilSimple, 'Finalize documentos clínicos'],
  ['resultadosChegados', 'resultados chegados', FileText, 'Novos exames aguardam revisão'],
  ['rascunhosDeOntem', 'rascunhos de ontem', NotePencil, 'Feche prontuários ainda abertos'],
  ['guiasAFaturar', 'guias a faturar', CurrencyDollar, 'Receita pronta para seguir'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return fmt.format(d);
}

/**
 * `porExtenso` acima formata em UTC de propósito e está certo: recebe uma DATA
 * ('AAAA-MM-DD'), ancora ao meio-dia UTC para escapar de borda de fuso e lê de
 * volta a mesma data. Não há instante envolvido.
 *
 * `hora` é o oposto: recebe um INSTANTE em UTC vindo da API. Formatar em UTC
 * mostrava o horário três horas adiantado no Brasil — a consulta das 14h
 * aparecia como 17:00 na fila, e a recepção chamava o paciente errado.
 */
function hora(iso: string, fuso: string): string {
  return horaNaClinica(iso, fuso);
}

/** Esqueleto de carregamento para a página Hoje */
function HojeSkeleton() {
  return (
    <div className="cadencia-page space-y-6">
      {/* Título skeleton */}
      <div className="space-y-2">
        <Skeleton variant="text" width="120px" />
        <Skeleton variant="text" width="200px" />
      </div>

      {/* Contadores skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="card" height="80px" />
        ))}
      </div>

      {/* Lista skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} variant="table-row" />
        ))}
      </div>
    </div>
  );
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores);
      setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => {
    void p.carregarPrecisaDeVoce().then(setPrecisa);
  }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) =>
      atual.map((l) =>
        l.appointmentId === linha.appointmentId
          ? { ...l, status: 'aguardando' as const }
          : l,
      ),
    );
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) =>
        atual.map((l) =>
          l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l,
        ),
      );
    }
  }

  /* ── Estado de carregamento ──────────────────────────────────────── */
  if (contadores === null) {
    return <HojeSkeleton />;
  }

  return (
    <div className="cadencia-page space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────── */}
      <PageHeader
        titulo="Hoje"
        subtitulo={porExtenso(p.dia)}
        semBreadcrumb
        className="pb-0"
        acoes={
          p.mensagensNaoLidasTotal > 0 ? (
            <span
              aria-label={`${p.mensagensNaoLidasTotal} mensagens não lidas`}
              className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-on text-xs font-semibold"
            >
              {p.mensagensNaoLidasTotal}
            </span>
          ) : undefined
        }
      />

      {/* ── Faixa de contadores ────────────────────────────────────── */}
      <FaixaDeContadores
        contadores={contadores}
        {...(p.filtro !== undefined ? { filtroAtivo: p.filtro } : {})}
        aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
      />

      {/* ── Fila de atendimentos ou Estado vazio ───────────────────── */}
      {fila.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/70 px-6 py-16 text-center shadow-elev-1">
          <Icone icon={CalendarBlank} size="xl" className="text-text-muted mb-3" />
          <p className="text-base font-medium text-text">Nenhum agendamento hoje</p>
          <p className="text-sm text-text-muted mt-1">Sua agenda está livre!</p>
          <Botao variante="primario" className="mt-4" iconeEsquerda={Plus}>
            Novo agendamento
          </Botao>
        </div>
      ) : (
        <section aria-label="Fila de atendimentos">
          <h2 className="text-base font-semibold text-text mb-3">
            Fila de atendimentos
          </h2>
          <ul className="list-none m-0 p-0 rounded-xl border border-line bg-surface shadow-elev-1 overflow-hidden">
            {fila.map((l) => (
              <LinhaDaAgenda
                key={l.appointmentId}
                hora={hora(l.startsAt, p.timezone)}
                paciente={l.displayName}
                profissional={l.professionalNome ?? l.professionalId}
                {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
                {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
                status={l.status}
                encaixe={l.encaixe}
                cadastroPreliminar={l.cadastroPreliminar}
                primeiraVez={l.primeiraVez}
                teleconsulta={l.teleconsulta}
              />
            ))}
          </ul>
          <div className="flex gap-2 mt-3 flex-wrap">
            {fila.map((l) => (
              <span key={l.appointmentId} className="contents">
                <Botao
                  variante="secundario"
                  tamanho="sm"
                  aria-label={`Check-in de ${l.displayName}`}
                  onClick={() => {
                    void checkIn(l);
                  }}
                >
                  Check-in
                </Botao>
                <Botao
                  variante="fantasma"
                  tamanho="sm"
                  aria-label={`Abrir atendimento de ${l.displayName}`}
                  onClick={() => p.aoAbrirAtendimento(l)}
                >
                  {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
                </Botao>
                <Botao
                  variante="fantasma"
                  tamanho="sm"
                  aria-label={`Mensagem para ${l.displayName}`}
                  onClick={() => p.aoMensagem(l)}
                >
                  {l.mensagensNaoLidas > 0
                    ? `Mensagem (${l.mensagensNaoLidas})`
                    : 'Mensagem'}
                </Botao>
                {l.pagamentoPendente ? (
                  <Botao
                    variante="fantasma"
                    tamanho="sm"
                    aria-label={`Cobrar ${l.displayName}`}
                    onClick={() => p.aoCobrar(l)}
                  >
                    Cobrar
                  </Botao>
                ) : null}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Precisa de você ────────────────────────────────────────── */}
      {precisa !== null && (
        <section aria-label="Precisa de você">
          <h2 className="text-base font-semibold text-text mb-3">
            Precisa de você
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PENDENCIAS.map(([chave, rotulo, IconePendencia, apoio]) => (
              <div
                key={chave}
                className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-elev-1 transition-all-fast cursor-pointer hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2"
              >
                <Icone
                  icon={IconePendencia}
                  size="lg"
                  className="mt-0.5 shrink-0 rounded-lg bg-accent-soft p-2 text-accent"
                />
                <div>
                  <p className="text-sm font-medium text-text">{precisa[chave]}</p>
                  <p className="text-xs text-text-muted mt-0.5">{rotulo}</p>
                  <p className="text-xs text-text-faint mt-1">{apoio}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
