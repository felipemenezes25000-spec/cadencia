'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarBlank,
  ChatCircle,
  CheckCircle,
  Clock,
  FunnelSimple,
  MagnifyingGlass,
  Play,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import type { Appointment, AppointmentStatus } from '../../domain/appointments/types';
import { mockRepository } from '../../data/mockRepository';
import { useToast } from '../../ui/ToastProvider';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Metric } from '../ui/Metric';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { Tabs } from '../ui/Tabs';
import { AppointmentCard } from './AppointmentCard';
import { AppointmentRow } from './AppointmentRow';
import { CheckInDrawer } from './CheckInDrawer';
import { PatientQuickView } from './PatientQuickView';

type FlowView = 'queue' | 'agenda' | 'board';
type StatusFilter = 'all' | 'waiting' | 'in_progress' | 'completed' | 'scheduled';

const flowViews = [
  { id: 'queue', label: 'Fila' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'board', label: 'Quadro' },
] as const;

export function TodayOperations() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<Appointment[]>(() => [...mockRepository.listAppointments()]);
  const [view, setView] = useState<FlowView>('queue');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [professional, setProfessional] = useState('all');
  const [insurer, setInsurer] = useState('all');
  const [query, setQuery] = useState('');
  const [quickView, setQuickView] = useState<Appointment | null>(null);
  const [checkIn, setCheckIn] = useState<Appointment | null>(null);

  const counts = useMemo(() => ({
    total: items.length,
    scheduled: items.filter((item) => ['scheduled', 'confirmation_pending', 'confirmed'].includes(item.status)).length,
    confirmed: items.filter((item) => item.status === 'confirmed').length,
    waiting: items.filter((item) => ['waiting', 'called'].includes(item.status)).length,
    inProgress: items.filter((item) => ['in_progress', 'closing'].includes(item.status)).length,
    noShow: items.filter((item) => item.status === 'no_show').length,
  }), [items]);

  const visible = useMemo(() => items.filter((item) => {
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'scheduled' ? ['scheduled', 'confirmation_pending', 'confirmed'].includes(item.status) : item.status === statusFilter);
    const matchesProfessional = professional === 'all' || item.professional === professional;
    const matchesInsurer = insurer === 'all' || item.insurer === insurer;
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    const matchesQuery = normalized.length === 0 || `${item.patientName} ${item.procedure} ${item.insurer}`.toLocaleLowerCase('pt-BR').includes(normalized);
    return matchesStatus && matchesProfessional && matchesInsurer && matchesQuery;
  }), [items, statusFilter, professional, insurer, query]);

  const current = items.find((item) => item.patientId === 'PAC-004')
    ?? items.find((item) => item.status === 'in_progress') ?? items[0];
  const next = items.find((item) => item.patientId === 'PAC-003')
    ?? items.find((item) => item.status === 'waiting')
    ?? items.find((item) => item.status === 'confirmed');

  function updateStatus(id: string, status: AppointmentStatus) {
    setItems((currentItems) => currentItems.map((item) => item.id === id ? { ...item, status } : item));
  }

  function primary(appointment: Appointment) {
    if (appointment.status === 'confirmed') { setCheckIn(appointment); return; }
    if (appointment.status === 'waiting') {
      updateStatus(appointment.id, 'called');
      toast({ tipo: 'sucesso', mensagem: `${appointment.patientName} foi chamado. ${appointment.room ?? 'Sala disponível'}.` });
      return;
    }
    if (appointment.status === 'scheduled' || appointment.status === 'confirmation_pending') {
      updateStatus(appointment.id, 'confirmed');
      toast({ tipo: 'sucesso', mensagem: `Atendimento de ${appointment.patientName} confirmado.` });
      return;
    }
    router.push(`/atendimentos/${appointment.encounterId}`);
  }

  const statusTabs = [
    { id: 'all', label: 'Todos', count: items.length },
    { id: 'waiting', label: 'Aguardando', count: counts.waiting },
    { id: 'in_progress', label: 'Em atendimento', count: counts.inProgress },
    { id: 'completed', label: 'Concluídos', count: items.filter((item) => item.status === 'completed').length },
    { id: 'scheduled', label: 'Agendados', count: counts.scheduled },
  ] as const;
  const professionalOptions = [...new Set(items.map((item) => item.professional))];
  const insurerOptions = [...new Set(items.map((item) => item.insurer))];

  return (
    <div className="clinical-page space-y-6">
      <PageHeader
        title="Hoje"
        description="Operação da unidade em tempo real"
        actions={<Button iconLeft={ChatCircle}>Enviar mensagem</Button>}
      />

      <section aria-label="Indicadores do dia" className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1 grid-cols-2 sm:grid-cols-5">
        <Metric value={counts.total} label="Agendados" detail="Hoje" icon={CalendarBlank} />
        <Metric value={counts.confirmed} label="Confirmados" detail="Hoje" icon={CheckCircle} tone="success" />
        <Metric value={counts.waiting} label="Aguardando" detail="Na fila" icon={Clock} tone="warning" active={counts.waiting > 0} />
        <Metric value={counts.inProgress} label="Em atendimento" detail="Agora" icon={Play} tone="brand" />
        <Metric value={counts.noShow} label="Faltas" detail="Hoje" icon={XCircle} tone="danger" />
      </section>

      <section aria-labelledby="attention-title" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-warning/20 bg-surface px-4 py-3.5">
        <div className="flex min-w-[240px] items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger"><WarningCircle size={19} weight="fill" aria-hidden /></span>
          <div><h2 id="attention-title" className="text-sm font-bold text-text-primary">Atenção necessária</h2><p className="text-xs text-text-secondary">3 ações antes das 10:30</p></div>
        </div>
        <div className="flex flex-1 flex-wrap gap-x-6 gap-y-2 text-xs text-text-secondary">
          <span><strong className="text-text-primary">3</strong> resultados aguardando revisão</span>
          <span><strong className="text-danger">2</strong> autorizações vencendo</span>
          <span><strong className="text-text-primary">1</strong> paciente aguardando retorno</span>
        </div>
        <Button size="sm" variant="ghost">Ver todas</Button>
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
        <section aria-labelledby="today-flow-title" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h2 id="today-flow-title" className="text-lg font-bold tracking-tight text-text-primary">Fluxo de hoje</h2><p className="mt-0.5 text-xs text-text-secondary">Paciente, estado atual e próxima ação</p></div>
            <Tabs items={flowViews} active={view} onChange={setView} label="Visualização do fluxo" />
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3">
              <Tabs items={statusTabs} active={statusFilter} onChange={setStatusFilter} label="Filtrar por status" className="mr-auto" />
              <label className="relative min-w-[180px] flex-1 sm:max-w-[240px]"><span className="sr-only">Buscar na fila</span><MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-2.5 text-text-tertiary" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar na fila" className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs outline-none focus:border-brand" /></label>
              <label><span className="sr-only">Filtrar profissional</span><select value={professional} onChange={(event) => setProfessional(event.target.value)} className="h-9 max-w-[170px] rounded-lg border border-border bg-surface px-2.5 text-xs text-text-secondary"><option value="all">Todos profissionais</option>{professionalOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="max-lg:hidden"><span className="sr-only">Filtrar convênio</span><select value={insurer} onChange={(event) => setInsurer(event.target.value)} className="h-9 max-w-[150px] rounded-lg border border-border bg-surface px-2.5 text-xs text-text-secondary"><option value="all">Todos convênios</option>{insurerOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <Button size="sm" iconLeft={FunnelSimple} className="lg:hidden">Filtros</Button>
            </div>

            {view === 'queue' ? (
              <>
                <div className="hidden grid-cols-[64px_minmax(220px,1.5fr)_76px_minmax(128px,.8fr)_minmax(120px,.72fr)_36px] gap-3 border-b border-border bg-surface-subtle px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.06em] text-text-tertiary md:grid">
                  <span>Horário</span><span>Paciente / contexto</span><span>Espera</span><span>Status</span><span>Ação</span><span><span className="sr-only">Mais ações</span></span>
                </div>
                <div className="hidden md:block">
                  {visible.map((appointment) => <AppointmentRow key={appointment.id} appointment={appointment} selected={quickView?.id === appointment.id} onOpenPatient={() => setQuickView(appointment)} onPrimary={() => primary(appointment)} />)}
                </div>
                <div className="md:hidden">
                  {visible.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onOpenPatient={() => setQuickView(appointment)} onPrimary={() => primary(appointment)} />)}
                </div>
              </>
            ) : view === 'agenda' ? <CompactAgenda items={visible} onSelect={setQuickView} /> : <StatusBoard items={visible} onSelect={setQuickView} onPrimary={primary} />}

            {visible.length === 0 ? (
              <div className="px-6 py-14 text-center"><p className="font-semibold text-text-primary">Nenhum atendimento neste recorte</p><p className="mt-1 text-sm text-text-secondary">Ajuste os filtros para voltar ao fluxo completo de hoje.</p><Button size="sm" className="mt-4" onClick={() => { setStatusFilter('all'); setProfessional('all'); setInsurer('all'); setQuery(''); }}>Limpar filtros</Button></div>
            ) : null}
          </div>
        </section>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-[92px] xl:self-start">
          <NowPanel current={current} next={next} onPrimary={primary} onSelect={setQuickView} />
          <ActionInbox />
        </aside>
      </div>

      <PatientQuickView appointment={quickView} onClose={() => setQuickView(null)} />
      <CheckInDrawer
        appointment={checkIn}
        onClose={() => setCheckIn(null)}
        onComplete={(appointment) => {
          updateStatus(appointment.id, 'waiting');
          setCheckIn(null);
          toast({
            tipo: 'sucesso',
            mensagem: `Check-in realizado. ${appointment.patientName} entrou na fila às ${appointment.time}.`,
            acao: {
              rotulo: 'Desfazer',
              aoClicar: () => updateStatus(appointment.id, appointment.status),
            },
          });
        }}
      />
    </div>
  );
}

function NowPanel({ current, next, onPrimary, onSelect }: {
  readonly current: Appointment | undefined;
  readonly next: Appointment | undefined;
  readonly onPrimary: (appointment: Appointment) => void;
  readonly onSelect: (appointment: Appointment) => void;
}) {
  return (
    <section aria-labelledby="now-title" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
      <header className="border-b border-border px-4 py-3"><h2 id="now-title" className="text-base font-bold text-text-primary">Agora</h2><p className="text-xs text-text-secondary">Situação atual da unidade</p></header>
      {current ? <div className="p-4"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.08em] text-brand">Em atendimento</p><button type="button" onClick={() => onSelect(current)} className="flex w-full items-center gap-3 rounded-lg text-left"><Avatar initials={current.patientInitials} name={current.patientName} size="lg" /><span><span className="block text-sm font-bold text-text-primary">{current.patientName}</span><span className="block text-xs text-text-secondary">{current.time} · {current.procedure}</span><span className="block text-xs text-text-tertiary">{current.professional}</span></span></button><Button fullWidth variant="primary" className="mt-4" onClick={() => onPrimary(current)}>Continuar atendimento</Button></div> : null}
      {next ? <div className="border-t border-border p-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-text-tertiary">Próximo</p><button type="button" onClick={() => onSelect(next)} className="text-left"><span className="block text-sm font-bold text-text-primary">{next.patientName}</span><span className="mt-0.5 block text-xs text-warning">{next.waitMinutes !== null ? `Aguardando há ${next.waitMinutes} min` : 'Chegada confirmada'}</span><span className="block text-xs text-text-tertiary">{next.room ?? 'Atendimento remoto'}</span></button><Button fullWidth className="mt-3" onClick={() => onPrimary(next)}>Chamar paciente</Button></div> : null}
    </section>
  );
}

function ActionInbox() {
  const items = mockRepository.listWorkItems();
  return (
    <section aria-labelledby="action-inbox-title" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
      <header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 id="action-inbox-title" className="text-base font-bold text-text-primary">Caixa de ações</h2><p className="text-xs text-text-secondary">Pendências da unidade</p></div><Badge tone="danger">{items.length}</Badge></header>
      <div>{items.slice(0, 4).map((item) => <button key={item.id} type="button" className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 transition-colors-fast hover:bg-surface-subtle"><Badge tone={item.priority === 'Alta' ? 'danger' : item.priority === 'Média' ? 'warning' : 'neutral'}>{item.priority}</Badge><span className="min-w-0"><span className="block text-sm font-semibold text-text-primary">{item.title}</span><span className="mt-0.5 block text-xs text-text-secondary">{item.context}</span></span></button>)}</div>
      <div className="border-t border-border p-2"><Button variant="ghost" size="sm" fullWidth>Ver todas as ações</Button></div>
    </section>
  );
}

function CompactAgenda({ items, onSelect }: { readonly items: readonly Appointment[]; readonly onSelect: (appointment: Appointment) => void }) {
  return <div className="p-4"><div className="relative ml-5 border-l border-border">{items.map((item) => <button key={item.id} type="button" onClick={() => onSelect(item)} className="relative flex w-full items-start gap-4 border-b border-border py-3 pl-6 text-left last:border-b-0"><span className="absolute -left-1.5 top-5 size-3 rounded-full border-2 border-surface bg-brand" /><time className="w-12 shrink-0 text-sm font-bold tabular-nums">{item.time}</time><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.patientName}</span><span className="block truncate text-xs text-text-secondary">{item.procedure} · {item.professional}</span></span><span className="ml-auto"><StatusBadge status={item.status} /></span></button>)}</div></div>;
}

function StatusBoard({ items, onSelect, onPrimary }: { readonly items: readonly Appointment[]; readonly onSelect: (appointment: Appointment) => void; readonly onPrimary: (appointment: Appointment) => void }) {
  const columns: readonly { label: string; statuses: readonly AppointmentStatus[] }[] = [
    { label: 'Aguardando', statuses: ['waiting', 'called'] },
    { label: 'Em atendimento', statuses: ['in_progress', 'closing'] },
    { label: 'Próximos', statuses: ['confirmed', 'scheduled', 'confirmation_pending'] },
  ];
  return <div className="grid gap-3 bg-surface-subtle p-3 lg:grid-cols-3">{columns.map((column) => <section key={column.label} className="rounded-lg border border-border bg-surface p-2"><h3 className="px-2 py-1.5 text-xs font-bold text-text-secondary">{column.label}</h3>{items.filter((item) => column.statuses.includes(item.status)).map((item) => <div key={item.id} className="mt-1 rounded-lg border border-border p-3"><button type="button" onClick={() => onSelect(item)} className="w-full text-left"><span className="block text-sm font-semibold">{item.patientName}</span><span className="block text-xs text-text-secondary">{item.time} · {item.procedure}</span></button><Button size="sm" fullWidth className="mt-3" onClick={() => onPrimary(item)}>{item.status === 'waiting' ? 'Chamar' : item.status === 'in_progress' ? 'Continuar' : 'Abrir'}</Button></div>)}</section>)}</div>;
}
