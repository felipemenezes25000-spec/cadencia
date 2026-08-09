'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarBlank,
  ChatCircle,
  CurrencyDollar,
  FileText,
  NotePencil,
  PencilSimple,
  Plus,
  ArrowRight,
  Clock,
  Stethoscope,
  Sparkle,
  Lightning,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
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
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) => Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
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
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

function HojeSkeleton() {
  return (
    <div className="cadencia-page p-4 space-y-6" data-testid="hoje-skeleton">
      <div className="space-y-3"><Skeleton variant="text" width="110px" /><Skeleton variant="text" width="280px" height="38px" /></div>
      <Skeleton variant="card" height="180px" className="rounded-[24px]" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="card" height="88px" />)}
      </div>
      <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="table-row" height="72px" />)}</div>
    </div>
  );
}

function StatusOrb({ contadores }: { readonly contadores: Contadores }) {
  const total = Math.max(contadores.agendados, 1);
  const concluidos = contadores.atendidos;
  const percentual = Math.min(100, Math.round((concluidos / total) * 100));
  return (
    <div className="relative grid h-[132px] w-[132px] shrink-0 place-items-center max-sm:h-[112px] max-sm:w-[112px]" role="img" aria-label={`${percentual}% da agenda concluída`}>
      <div className="absolute inset-0 rounded-full border border-accent/10 bg-accent/[.035]" />
      <div className="absolute inset-[10px] rounded-full border-[7px] border-surface-sunken" />
      <div
        className="absolute inset-[10px] rounded-full"
        style={{ background: `conic-gradient(var(--accent) ${percentual * 3.6}deg, transparent 0)`, mask: 'radial-gradient(circle, transparent 55%, black 57%)', WebkitMask: 'radial-gradient(circle, transparent 55%, black 57%)' }}
      />
      <div className="relative text-center">
        <strong className="block text-[28px] font-semibold leading-none tracking-[-.05em] text-text tabular-nums">{concluidos}</strong>
        <span className="mt-1 block text-[10px] font-bold uppercase tracking-[.12em] text-text-faint">atendidos</span>
      </div>
    </div>
  );
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);

  useEffect(() => {
    let ativo = true;
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      if (ativo) { setContadores(r.contadores); setFila(r.fila); }
    });
    return () => { ativo = false; };
  }, [p.dia, p.filtro, p.carregarDia]);

  useEffect(() => {
    let ativo = true;
    void p.carregarPrecisaDeVoce().then((r) => { if (ativo) setPrecisa(r); });
    return () => { ativo = false; };
  }, [p.carregarPrecisaDeVoce]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) => atual.map((l) => l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) => l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  const proximo = useMemo(() => fila.find((l) => !['atendido', 'cancelado', 'faltou'].includes(l.status)) ?? fila[0], [fila]);
  const totalPendencias = precisa ? Object.values(precisa).reduce((s, n) => s + n, 0) : 0;

  if (contadores === null) return <HojeSkeleton />;

  return (
    <div className="cadencia-page space-y-6">
      <PageHeader
        titulo="Hoje"
        subtitulo={porExtenso(p.dia)}
        semBreadcrumb
        className="pb-1"
        acoes={p.mensagensNaoLidasTotal > 0 ? (
          <button
            type="button"
            aria-label={`${p.mensagensNaoLidasTotal} mensagens não lidas`}
            className="group inline-flex min-h-9 items-center gap-2 rounded-xl border border-line bg-surface/85 px-3 text-xs font-semibold text-text shadow-elev-1 transition-all hover:-translate-y-px hover:shadow-elev-2"
          >
            <span className="relative"><ChatCircle size={17} className="text-accent" /><span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" /></span>
            {p.mensagensNaoLidasTotal} novas
          </button>
        ) : undefined}
      />

      <motion.section
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05, duration: .38 }}
        className="cadencia-panel cadencia-panel-hero grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center"
        aria-label="Resumo operacional do dia"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-accent"><Sparkle size={13} weight="fill" /> Ritmo da clínica</div>
          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
            <strong className="text-[clamp(2rem,5vw,3.7rem)] font-semibold leading-none tracking-[-.065em] text-text tabular-nums">{contadores.agendados}</strong>
            <span className="pb-1 text-sm font-medium text-text-muted">agendamentos no radar</span>
          </div>
          {proximo ? (
            <div className="mt-5 flex max-w-2xl items-center gap-3 rounded-2xl border border-line/70 bg-surface/72 p-3.5 shadow-[inset_0_1px_0_oklch(100%_0_0_/_0.6)]">
              <span className="cadencia-icon-orb h-10 w-10 shrink-0"><Clock size={18} weight="duotone" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[.1em] text-text-faint">Próximo movimento · {hora(proximo.startsAt)}</p>
                <p className="m-0 mt-0.5 truncate text-sm font-semibold text-text">{proximo.displayName}</p>
              </div>
              <ArrowRight size={17} className="shrink-0 text-text-faint" aria-hidden />
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-muted">Agenda concluída. O dia está limpo.</p>
          )}
        </div>
        <StatusOrb contadores={contadores} />
      </motion.section>

      <FaixaDeContadores
        contadores={contadores}
        {...(p.filtro !== undefined ? { filtroAtivo: p.filtro } : {})}
        aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
      />

      <div className="cadencia-shell-grid">
        <section aria-label="Fila de atendimentos" className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="cadencia-eyebrow">Operação ao vivo</div>
              <h2 className="m-0 mt-1 text-lg font-semibold tracking-[-.03em] text-text">Fila de atendimentos</h2>
            </div>
            {fila.length > 0 && <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted">{fila.length} na fila</span>}
          </div>

          {fila.length === 0 ? (
            <div className="cadencia-panel flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="cadencia-icon-orb mb-4 h-14 w-14"><CalendarBlank size={26} weight="duotone" /></div>
              <p className="m-0 text-base font-semibold text-text">Nenhum agendamento hoje</p>
              <p className="mt-1 text-sm text-text-muted">Sua agenda esta livre!</p>
              <Botao variante="primario" className="mt-5" iconeEsquerda={Plus}>Novo agendamento</Botao>
            </div>
          ) : (
            <ul className="cadencia-data-grid m-0 list-none p-0" aria-label="Fila clínica do dia">
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
                  className="last:border-b-0"
                  acoes={
                    <>
                      <Botao variante={l.status === 'agendado' ? 'primario' : 'secundario'} tamanho="sm" aria-label={`Check-in de ${l.displayName}`} onClick={() => { void checkIn(l); }}>Check-in</Botao>
                      <Botao variante="fantasma" tamanho="sm" iconeEsquerda={Stethoscope} aria-label={`Abrir atendimento de ${l.displayName}`} onClick={() => p.aoAbrirAtendimento(l)}>{l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}</Botao>
                      <Botao variante="fantasma" tamanho="sm" aria-label={`Mensagem para ${l.displayName}`} onClick={() => p.aoMensagem(l)}>{l.mensagensNaoLidas > 0 ? `Mensagem (${l.mensagensNaoLidas})` : 'Mensagem'}</Botao>
                      {l.pagamentoPendente && <Botao variante="fantasma" tamanho="sm" aria-label={`Cobrar ${l.displayName}`} onClick={() => p.aoCobrar(l)}>Cobrar</Botao>}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </section>

        {precisa !== null && (
          <section aria-label="Precisa de você" className="cadencia-sticky-rail">
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <div className="cadencia-eyebrow">Inbox operacional</div>
                <h2 className="m-0 mt-1 text-lg font-semibold tracking-[-.03em] text-text">Precisa de você</h2>
              </div>
              {totalPendencias > 0 && <span className="grid h-7 min-w-7 place-items-center rounded-full bg-danger-soft px-2 text-xs font-bold text-danger">{totalPendencias}</span>}
            </div>
            <div className="cadencia-panel overflow-hidden p-1.5">
              {PENDENCIAS.map(([chave, rotulo, IconePendencia, apoio], i) => (
                <button
                  key={chave} type="button"
                  className="group flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="cadencia-icon-orb h-10 w-10 shrink-0"><IconePendencia size={18} weight="duotone" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5"><strong className="text-sm font-semibold text-text tabular-nums">{precisa[chave]}</strong><span className="truncate text-xs font-medium text-text-muted">{rotulo}</span></span>
                    <span className="mt-0.5 block truncate text-[10px] text-text-faint">{apoio}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  {i === 0 && precisa[chave] > 0 && <span className="sr-only">Prioridade</span>}
                </button>
              ))}
            </div>
            {totalPendencias === 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-ok/15 bg-ok-soft/60 px-3 py-2 text-xs font-medium text-ok"><Lightning size={15} weight="fill" /> Tudo sob controle.</div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
