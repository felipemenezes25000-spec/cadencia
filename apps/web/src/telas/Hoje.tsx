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

export interface LinhaDaFila {
  readonly appointmentId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly patientId: string;
  readonly displayName: string;
  readonly professionalId: string;
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

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string, PhosphorIcon]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta', ChatCircle],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas', PencilSimple],
  ['resultadosChegados', 'resultados chegados', FileText],
  ['rascunhosDeOntem', 'rascunhos de ontem', NotePencil],
  ['guiasAFaturar', 'guias a faturar', CurrencyDollar],
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

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** Esqueleto de carregamento para a pagina Hoje */
function HojeSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Titulo skeleton */}
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
    <div className="space-y-6 p-6 max-sm:p-4">
      {/* ── Cabecalho ──────────────────────────────────────────────── */}
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icone icon={CalendarBlank} size="xl" className="text-text-muted mb-3" />
          <p className="text-base font-medium text-text">Nenhum agendamento hoje</p>
          <p className="text-sm text-text-muted mt-1">Sua agenda esta livre!</p>
          <Botao variante="primario" className="mt-4" iconeEsquerda={Plus}>
            Novo agendamento
          </Botao>
        </div>
      ) : (
        <section aria-label="Fila de atendimentos">
          <h2 className="text-base font-semibold text-text mb-3">
            Fila de atendimentos
          </h2>
          <ul className="list-none m-0 p-0 rounded-lg border border-line bg-surface overflow-hidden">
            {fila.map((l) => (
              <LinhaDaAgenda
                key={l.appointmentId}
                hora={hora(l.startsAt)}
                paciente={l.displayName}
                profissional={l.professionalId}
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

      {/* ── Precisa de voce ────────────────────────────────────────── */}
      {precisa !== null && (
        <section aria-label="Precisa de você">
          <h2 className="text-base font-semibold text-text mb-3">
            Precisa de você
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PENDENCIAS.map(([chave, rotulo, IconePendencia]) => (
              <div
                key={chave}
                className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 hover:bg-surface-raised transition-colors-fast cursor-pointer"
              >
                <Icone
                  icon={IconePendencia}
                  size="lg"
                  className="text-accent shrink-0 mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-text">{precisa[chave]}</p>
                  <p className="text-xs text-text-muted mt-0.5">{rotulo}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
