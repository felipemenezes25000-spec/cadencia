'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarBlank,
  ChatCircle,
  CheckCircle,
  Circle,
  Clock,
  CurrencyDollar,
  FileText,
  NotePencil,
  PencilSimple,
  Plus,
  Pulse,
  WarningCircle,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { AppointmentRow } from '../components/operations/AppointmentRow';
import {
  PatientQuickView,
  type PatientQuickSummary,
} from '../components/patients/PatientQuickView';
import { getPrimaryAction } from '../domain/appointments/actions';
import type { OperationalAppointment } from '../domain/appointments/queue';
import { horaNaClinica } from '../lib/fuso';
import { cn } from '../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Botao } from '../ui/Botao';
import { ChipDeStatus } from '../ui/ChipDeStatus';
import { EstadoVazio } from '../ui/EstadoVazio';
import { PainelLateral } from '../ui/PainelLateral';
import { Skeleton } from '../ui/Skeleton';

export type { OperationalAppointment as LinhaDaFila } from '../domain/appointments/queue';

export interface ContadoresDoDia {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number;
  readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number;
  readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export type FiltroDoFluxo = 'espera' | 'atendimento' | 'agendados' | 'concluidos';

export interface HojeProps {
  readonly dia: string;
  readonly timezone: string;
  readonly filtro?: FiltroDoFluxo;
  readonly mensagensNaoLidasTotal: number;
  readonly carregarDia: (dia: string) => Promise<{
    contadores: ContadoresDoDia;
    fila: OperationalAppointment[];
  }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly carregarResumoPaciente?: (patientId: string) => Promise<PatientQuickSummary>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoConfirmar?: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: OperationalAppointment) => void;
  readonly aoAbrirPaciente?: (patientId: string) => void;
  readonly aoReagendar?: (linha: OperationalAppointment) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoFluxo | undefined) => void;
  readonly aoMensagem: (linha: OperationalAppointment) => void;
  readonly aoCobrar: (linha: OperationalAppointment) => void;
  readonly aoNovoAtendimento?: () => void;
  readonly aoEnviarMensagem?: () => void;
}

const PENDENCIAS: ReadonlyArray<{
  chave: keyof PrecisaDeVoce;
  rotulo: string;
  apoio: string;
  icon: PhosphorIcon;
  prioridade: 'Alta' | 'Média' | 'Baixa';
}> = [
  { chave: 'confirmacoesSemResposta', rotulo: 'Confirmações sem resposta', apoio: 'Resolver antes que virem faltas', icon: ChatCircle, prioridade: 'Alta' },
  { chave: 'guiasAFaturar', rotulo: 'Guias aguardando faturamento', apoio: 'Receita pronta para seguir', icon: CurrencyDollar, prioridade: 'Alta' },
  { chave: 'resultadosChegados', rotulo: 'Resultados aguardando revisão', apoio: 'Novos exames disponíveis', icon: FileText, prioridade: 'Média' },
  { chave: 'prescricoesNaoAssinadas', rotulo: 'Prescrições não assinadas', apoio: 'Finalize documentos clínicos', icon: PencilSimple, prioridade: 'Média' },
  { chave: 'rascunhosDeOntem', rotulo: 'Rascunhos de ontem', apoio: 'Feche prontuários ainda abertos', icon: NotePencil, prioridade: 'Baixa' },
];

function dataPorExtenso(dia: string): string {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(`${dia}T12:00:00Z`));
  return texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1);
}

function HojeSkeleton() {
  return (
    <div className="cadencia-page space-y-5" aria-label="Carregando operação de hoje">
      <div className="space-y-2"><Skeleton variant="text" width="260px" /><Skeleton variant="text" width="360px" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="card" height="78px" />)}</div>
      <Skeleton variant="card" height="56px" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_350px]"><Skeleton variant="card" height="520px" /><Skeleton variant="card" height="520px" /></div>
    </div>
  );
}

export function Hoje(props: HojeProps) {
  const [contadores, setContadores] = useState<ContadoresDoDia | null>(null);
  const [fila, setFila] = useState<OperationalAppointment[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const [erroDeAcao, setErroDeAcao] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<OperationalAppointment | null>(null);
  const [quickTarget, setQuickTarget] = useState<OperationalAppointment | null>(null);
  const [quickSummary, setQuickSummary] = useState<PatientQuickSummary | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const quickGeneration = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRecarga((valor) => valor + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setErroCarga(false);
    void props.carregarDia(props.dia).then((result) => {
      if (!active) return;
      setContadores(result.contadores);
      setFila(result.fila);
    }).catch(() => {
      if (active) setErroCarga(true);
    });
    return () => { active = false; };
  }, [props.carregarDia, props.dia, recarga]);

  useEffect(() => {
    let active = true;
    void props.carregarPrecisaDeVoce().then((result) => {
      if (active) setPrecisa(result);
    }).catch(() => {
      if (active) setPrecisa(null);
    });
    return () => { active = false; };
  }, [props.carregarPrecisaDeVoce, recarga]);

  const emAtendimento = fila.filter((item) => item.status === 'atendendo');
  const aguardando = fila.filter((item) => item.status === 'aguardando');
  const totalPendencias = precisa ? Object.values(precisa).reduce((total, valor) => total + valor, 0) : 0;

  const filaVisivel = useMemo(() => fila.filter((item) => {
    if (props.filtro === 'espera') return item.status === 'aguardando';
    if (props.filtro === 'atendimento') return item.status === 'atendendo';
    if (props.filtro === 'agendados') return item.status === 'agendado' || item.status === 'confirmado';
    if (props.filtro === 'concluidos') return item.status === 'atendido' || item.status === 'faltou';
    return true;
  }), [fila, props.filtro]);

  async function concluirCheckIn(): Promise<void> {
    if (!checkInTarget) return;
    const item = checkInTarget;
    setAcaoEmCurso(item.appointmentId);
    setErroDeAcao(null);
    try {
      await props.aoCheckIn(item.appointmentId);
      setFila((atual) => atual.map((linha) => linha.appointmentId === item.appointmentId ? { ...linha, status: 'aguardando' } : linha));
      setCheckInTarget(null);
      setFeedback(`Check-in realizado. ${item.displayName} entrou na fila.`);
    } catch {
      setErroDeAcao('Não foi possível atualizar o check-in. A alteração não foi registrada.');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function executarAcao(item: OperationalAppointment): Promise<void> {
    const action = getPrimaryAction(item.status);
    if (action.id === 'checkin') {
      setErroDeAcao(null);
      setCheckInTarget(item);
      return;
    }
    if (action.id === 'abrir_atendimento') {
      props.aoAbrirAtendimento(item);
      return;
    }
    if (action.id === 'ver_atendimento') {
      if (item.encounterId) props.aoAbrirAtendimento(item);
      else props.aoAbrirPaciente?.(item.patientId);
      return;
    }
    if (action.id === 'reagendar') {
      props.aoReagendar?.(item);
      return;
    }
    if (action.id === 'ver_detalhes') {
      abrirQuickView(item);
      return;
    }
    if (!props.aoConfirmar) return;
    setAcaoEmCurso(item.appointmentId);
    setErroDeAcao(null);
    try {
      await props.aoConfirmar(item.appointmentId);
      setFila((atual) => atual.map((linha) => linha.appointmentId === item.appointmentId ? { ...linha, status: 'confirmado' } : linha));
      setFeedback(`${item.displayName} foi confirmado.`);
    } catch {
      setErroDeAcao('Não foi possível confirmar o atendimento. A alteração não foi registrada.');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  function abrirQuickView(item: OperationalAppointment) {
    const generation = ++quickGeneration.current;
    setQuickTarget(item);
    setQuickSummary(null);
    if (!props.carregarResumoPaciente) return;
    setQuickLoading(true);
    void props.carregarResumoPaciente(item.patientId).then((summary) => {
      if (generation === quickGeneration.current) setQuickSummary(summary);
    }).catch(() => {
      if (generation === quickGeneration.current) setQuickSummary(null);
    }).finally(() => {
      if (generation === quickGeneration.current) setQuickLoading(false);
    });
  }

  if (contadores === null && !erroCarga) return <HojeSkeleton />;
  if (erroCarga || contadores === null) {
    return (
      <div className="cadencia-page">
        <EstadoVazio
          icone={WarningCircle}
          titulo="Não foi possível carregar a operação de hoje"
          descricao="A agenda não foi alterada. Verifique a conexão e tente novamente."
          acao={<Botao onClick={() => setRecarga((n) => n + 1)}>Tentar novamente</Botao>}
        />
      </div>
    );
  }

  const now = emAtendimento[0] ?? null;
  const next = aguardando[0] ?? fila.find((item) => item.status === 'confirmado' || item.status === 'agendado') ?? null;

  return (
    <div className="cadencia-page space-y-5 pb-28 md:pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 aria-label="Hoje" className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-text">
            Hoje <span className="font-medium text-text">· {dataPorExtenso(props.dia)}</span>
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            <span className="font-semibold text-text">{contadores.agendados} atendimentos</span>
            {' · '}{aguardando.length} em espera{' · '}{emAtendimento.length} em atendimento
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="mr-1 inline-flex items-center gap-2 text-xs text-text-faint">
            <span className="size-2 rounded-full bg-ok" aria-hidden /> Atualizado agora
          </span>
          <Botao variante="secundario" iconeEsquerda={ChatCircle} onClick={props.aoEnviarMensagem}>
            Enviar mensagem{props.mensagensNaoLidasTotal > 0 ? ` (${props.mensagensNaoLidasTotal})` : ''}
          </Botao>
          <Botao iconeEsquerda={Plus} onClick={props.aoNovoAtendimento}>Novo atendimento</Botao>
        </div>
      </header>

      <section aria-label="Resumo do dia" className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4">
        <Metric icon={CalendarBlank} value={contadores.agendados} label="Hoje" />
        <Metric icon={Pulse} value={emAtendimento.length} label="Em atendimento" tone="success" />
        <Metric icon={Clock} value={aguardando.length} label="Aguardando" tone="warning" />
        <Metric icon={WarningCircle} value={totalPendencias} label="Pendências" tone={totalPendencias > 0 ? 'danger' : 'neutral'} />
      </section>

      <AttentionBanner precisa={precisa} total={totalPendencias} />

      {erroDeAcao ? (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span><strong>Alteração não concluída.</strong> {erroDeAcao}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => setErroDeAcao(null)}>Fechar</button>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_350px]">
        <section id="fluxo-de-hoje" aria-labelledby="titulo-fluxo" className="order-1 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-4 pt-4 sm:px-5">
            <h2 id="titulo-fluxo" className="text-lg font-bold tracking-tight text-text">Fluxo de hoje</h2>
            <div className="mt-3 flex gap-5 overflow-x-auto scrollbar-thin">
              <FlowTab active={!props.filtro} label="Todos" count={contadores.agendados} onClick={() => props.aoMudarFiltro(undefined)} />
              <FlowTab active={props.filtro === 'espera'} label="Em espera" count={aguardando.length} onClick={() => props.aoMudarFiltro('espera')} />
              <FlowTab active={props.filtro === 'atendimento'} label="Em atendimento" count={emAtendimento.length} onClick={() => props.aoMudarFiltro('atendimento')} />
              <FlowTab active={props.filtro === 'agendados'} label="Agendados" count={fila.filter((x) => x.status === 'agendado' || x.status === 'confirmado').length} onClick={() => props.aoMudarFiltro('agendados')} />
              <FlowTab active={props.filtro === 'concluidos'} label="Concluídos" count={fila.filter((x) => x.status === 'atendido' || x.status === 'faltou').length} onClick={() => props.aoMudarFiltro('concluidos')} />
            </div>
          </div>
          <div className="hidden grid-cols-[72px_minmax(220px,1fr)_88px_148px_136px_36px] gap-x-4 border-b border-line bg-surface-subtle px-4 py-2 text-[10px] font-bold uppercase tracking-[.07em] text-text-faint md:grid">
            <span>Horário</span><span>Paciente / atendimento</span><span>Espera</span><span>Status</span><span>Ação</span><span><span className="sr-only">Mais</span></span>
          </div>
          {filaVisivel.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {filaVisivel.map((item) => (
                <AppointmentRow
                  key={item.appointmentId}
                  appointment={item}
                  horario={horaNaClinica(item.startsAt, props.timezone)}
                  selected={quickTarget?.appointmentId === item.appointmentId}
                  loading={acaoEmCurso === item.appointmentId}
                  onPatientClick={() => abrirQuickView(item)}
                  onPrimaryAction={() => { void executarAcao(item); }}
                  onMessage={() => props.aoMensagem(item)}
                  onOpenPatient={() => props.aoAbrirPaciente?.(item.patientId)}
                  onCharge={() => props.aoCobrar(item)}
                />
              ))}
            </ul>
          ) : (
            <EstadoVazio
              icone={CalendarBlank}
              titulo={props.filtro ? 'Nenhum paciente neste estado' : 'Nenhum atendimento hoje'}
              descricao={props.filtro ? 'Os pacientes aparecem aqui assim que mudam de etapa.' : 'A unidade está sem atendimentos agendados para hoje.'}
              compacto
            />
          )}
        </section>

        <UnitPanel
          now={now}
          next={next}
          precisa={precisa}
          timezone={props.timezone}
          onNow={() => { if (now) props.aoAbrirAtendimento(now); }}
          onNext={() => { if (next) void executarAcao(next); }}
        />
      </div>

      <PatientQuickView
        appointment={quickTarget}
        summary={quickSummary}
        loading={quickLoading}
        open={quickTarget !== null}
        onClose={() => {
          quickGeneration.current += 1;
          setQuickTarget(null);
          setQuickSummary(null);
          setQuickLoading(false);
        }}
        onOpenPatient={() => { if (quickTarget) props.aoAbrirPaciente?.(quickTarget.patientId); }}
        onOpenAppointment={() => { if (quickTarget) props.aoAbrirAtendimento(quickTarget); }}
      />

      <CheckInPanel
        appointment={checkInTarget}
        loading={checkInTarget ? acaoEmCurso === checkInTarget.appointmentId : false}
        error={erroDeAcao}
        onClose={() => { setCheckInTarget(null); setErroDeAcao(null); }}
        onConfirm={() => { void concluirCheckIn(); }}
      />

      {feedback ? (
        <div role="status" className="fixed bottom-20 right-4 z-[70] max-w-sm rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-text shadow-elev-2 md:bottom-6">
          <div className="flex items-start gap-3"><CheckCircle size={18} className="mt-0.5 shrink-0 text-ok" aria-hidden /><span className="flex-1">{feedback}</span><button type="button" aria-label="Fechar confirmação" className="text-text-faint" onClick={() => setFeedback(null)}>×</button></div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icone, value, label, tone = 'neutral' }: {
  readonly icon: PhosphorIcon;
  readonly value: number;
  readonly label: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="flex min-h-[78px] items-center gap-3 border-b border-r border-line px-4 py-3 last:border-r-0 lg:border-b-0">
      <span className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg',
        tone === 'success' ? 'bg-ok-soft text-ok' : tone === 'warning' ? 'bg-warn-soft text-warn' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
      )}><Icone size={19} aria-hidden /></span>
      <span><strong className="block text-xl leading-none text-text tabular-nums">{value}</strong><span className="mt-1 block text-xs font-semibold text-text-muted">{label}</span></span>
    </div>
  );
}

function AttentionBanner({ precisa, total }: { readonly precisa: PrecisaDeVoce | null; readonly total: number }) {
  if (!precisa) return <Skeleton variant="card" height="56px" />;
  const detalhes = PENDENCIAS.filter((item) => precisa[item.chave] > 0).slice(0, 3);
  if (total === 0) {
    return (
      <section aria-label="Atenção necessária" className="flex min-h-14 items-center gap-3 rounded-xl border border-ok/20 bg-ok-soft/60 px-4 py-3 text-sm text-ok">
        <CheckCircle size={20} aria-hidden /><strong>Nenhuma pendência operacional agora</strong>
      </section>
    );
  }
  return (
    <section aria-label="Atenção necessária" className="flex flex-col gap-3 rounded-xl border border-warn/20 bg-warn-soft/55 px-4 py-3 sm:flex-row sm:items-center">
      <WarningCircle size={20} weight="fill" className="shrink-0 text-warn" aria-hidden />
      <strong className="text-sm text-text">{total} {total === 1 ? 'item precisa' : 'itens precisam'} da sua atenção</strong>
      <p className="min-w-0 flex-1 text-xs text-text-muted">
        {detalhes.map((item) => `${precisa[item.chave]} ${item.rotulo.toLocaleLowerCase('pt-BR')}`).join(' · ')}
      </p>
      <a href="#painel-unidade" className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-warn px-3 text-xs font-semibold text-white hover:brightness-95">Resolver</a>
    </section>
  );
}

function FlowTab({ active, label, count, onClick }: {
  readonly active: boolean;
  readonly label: string;
  readonly count: number;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('relative shrink-0 pb-3 text-xs font-semibold transition-colors-fast', active ? 'text-accent' : 'text-text-muted hover:text-text')}>
      {label} <span className="ml-1 text-[10px] tabular-nums">{count}</span>
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden /> : null}
    </button>
  );
}

function UnitPanel({ now, next, precisa, timezone, onNow, onNext }: {
  readonly now: OperationalAppointment | null;
  readonly next: OperationalAppointment | null;
  readonly precisa: PrecisaDeVoce | null;
  readonly timezone: string;
  readonly onNow: () => void;
  readonly onNext: () => void;
}) {
  return (
    <aside id="painel-unidade" aria-labelledby="titulo-painel-unidade" className="order-2 overflow-hidden rounded-2xl border border-line bg-surface lg:sticky lg:top-[88px]">
      <h2 id="titulo-painel-unidade" className="border-b border-line px-5 py-4 text-lg font-bold tracking-tight text-text">Painel da unidade</h2>
      <section className="border-b border-line p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text"><span className="size-2 rounded-full bg-ok" aria-hidden />Agora</h3>
        {now ? (
          <div>
            <div className="flex items-start gap-3"><Avatar nome={now.displayName} /><div className="min-w-0"><p className="truncate text-sm font-bold text-text">{now.displayName}</p><p className="mt-0.5 text-xs text-text-muted">{horaNaClinica(now.startsAt, timezone)} · {now.procedureNome ?? 'Atendimento'}</p><p className="text-xs text-text-muted">{now.professionalNome ?? now.professionalId}</p></div></div>
            <div className="mt-3"><ChipDeStatus status={now.status} /></div>
            <Botao fullWidth className="mt-4" onClick={onNow}>Continuar atendimento</Botao>
          </div>
        ) : <p className="text-sm text-text-muted">Nenhum atendimento clínico em andamento.</p>}
      </section>
      <section className="border-b border-line p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text"><span className="size-2 rounded-full bg-warning" aria-hidden />Próximo</h3>
        {next ? (
          <div>
            <p className="text-sm font-bold text-text">{next.displayName}</p>
            <p className="mt-1 text-xs text-text-muted">{horaNaClinica(next.startsAt, timezone)} · {next.procedureNome ?? 'Atendimento'}</p>
            <p className="mt-2 text-xs font-medium text-warn">{next.status === 'aguardando' ? 'Aguardando na fila' : 'Ainda não chegou'}</p>
            <Botao variante="secundario" fullWidth className="mt-4" onClick={onNext}>{getPrimaryAction(next.status).label}</Botao>
          </div>
        ) : <p className="text-sm text-text-muted">Sem próximo atendimento no fluxo.</p>}
      </section>
      <section>
        <div className="flex items-center justify-between px-5 pb-2 pt-4"><h3 className="text-sm font-bold text-text">Pendências</h3><span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">{precisa ? Object.values(precisa).reduce((a, b) => a + b, 0) : 0}</span></div>
        {precisa ? (
          <ul className="m-0 list-none p-0">
            {PENDENCIAS.filter((item) => precisa[item.chave] > 0).map((item) => (
              <li key={item.chave} className="flex items-start gap-3 border-t border-line px-5 py-3 first:border-t-0">
                <span className={cn('mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold', item.prioridade === 'Alta' ? 'bg-danger-soft text-danger' : item.prioridade === 'Média' ? 'bg-warn-soft text-warn' : 'bg-surface-subtle text-text-muted')}>{item.prioridade}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-text">{precisa[item.chave]} {item.rotulo.toLocaleLowerCase('pt-BR')}</span><span className="block text-[11px] text-text-faint">{item.apoio}</span></span>
              </li>
            ))}
          </ul>
        ) : <div className="px-5 pb-5"><Skeleton variant="text" width="100%" /></div>}
      </section>
    </aside>
  );
}

function CheckInPanel({ appointment, loading, error, onClose, onConfirm }: {
  readonly appointment: OperationalAppointment | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <PainelLateral
      aberto={appointment !== null}
      onFechar={onClose}
      titulo="Check-in"
      descricao={appointment ? `${appointment.displayName} · ${appointment.procedureNome ?? 'Atendimento'}` : 'Confirmar chegada do paciente'}
      largura="md"
      rodape={appointment ? <div className="flex justify-end gap-2"><Botao variante="secundario" onClick={onClose}>Cancelar</Botao><Botao carregando={loading} onClick={onConfirm}>Concluir check-in</Botao></div> : undefined}
    >
      {appointment ? (
        <div className="space-y-1">
          <CheckItem label="Identificação" status={appointment.cadastroPreliminar ? 'warning' : 'ok'} text={appointment.cadastroPreliminar ? 'Cadastro preliminar — confira os dados na recepção' : 'Cadastro confirmado'} />
          <CheckItem label="Convênio" status="neutral" text={appointment.operadoraNome ?? 'Particular'} />
          <CheckItem label="Documentos" status="neutral" text="Sem bloqueio documental informado" />
          <CheckItem label="Pagamento" status={appointment.pagamentoPendente ? 'warning' : 'neutral'} text={appointment.pagamentoPendente ? 'Existe uma cobrança pendente' : 'Sem cobrança pendente informada'} />
          {error ? <div role="alert" className="mt-4 rounded-lg border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</div> : null}
        </div>
      ) : null}
    </PainelLateral>
  );
}

function CheckItem({ label, text, status }: { readonly label: string; readonly text: string; readonly status: 'ok' | 'warning' | 'neutral' }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-4 last:border-b-0">
      {status === 'ok' ? <CheckCircle size={18} className="mt-0.5 text-ok" aria-hidden />
        : status === 'warning' ? <WarningCircle size={18} className="mt-0.5 text-warn" aria-hidden />
          : <Circle size={18} className="mt-0.5 text-text-faint" aria-hidden />}
      <div><p className="text-[11px] font-bold uppercase tracking-[.07em] text-text-faint">{label}</p><p className="mt-1 text-sm font-medium text-text">{text}</p></div>
    </div>
  );
}
