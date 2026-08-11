'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CaretLeft,
  CaretRight,
  ChatCircle,
  FunnelSimple,
  X,
} from '@phosphor-icons/react';
import type { CalendarEventData } from '../../data/mockRepository';
import { mockRepository } from '../../data/mockRepository';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Button, IconButton } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { Tabs } from '../ui/Tabs';

type CalendarView = 'day' | 'week' | 'month' | 'list';

const days = [
  { short: 'SEG', day: 10 }, { short: 'TER', day: 11 }, { short: 'QUA', day: 12 },
  { short: 'QUI', day: 13 }, { short: 'SEX', day: 14 }, { short: 'SÁB', day: 15 },
  { short: 'DOM', day: 16 },
] as const;
const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'] as const;

export function AgendaWorkspace() {
  const [view, setView] = useState<CalendarView>('week');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selected, setSelected] = useState<CalendarEventData | null>(null);
  const [reschedule, setReschedule] = useState<CalendarEventData | null>(null);
  const events = mockRepository.listCalendarEvents();
  const viewTabs = [
    { id: 'day', label: 'Dia' }, { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mês' }, { id: 'list', label: 'Lista' },
  ] as const;

  return (
    <div className="clinical-page space-y-5">
      <PageHeader title="Agenda" description="Visão temporal e gerenciamento dos horários da unidade" />

      <section aria-label="Controles da agenda" className="rounded-xl border border-border bg-surface shadow-elev-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3">
          <Button size="sm">Hoje</Button>
          <IconButton icon={CaretLeft} label="Semana anterior" size="sm" />
          <IconButton icon={CaretRight} label="Próxima semana" size="sm" />
          <strong className="mx-2 text-sm tabular-nums text-text-primary">10 — 16 de agosto, 2026</strong>
          <Tabs items={viewTabs} active={view} onChange={setView} label="Visualização da agenda" className="ml-auto" />
          <Button size="sm" iconLeft={FunnelSimple} onClick={() => setFiltersOpen((open) => !open)}>Filtros</Button>
        </div>
        {filtersOpen ? (
          <div className="flex flex-wrap items-end gap-3 px-3 py-3">
            <Filter label="Profissional" options={['Todos', 'Dra. Helena Vasques', 'Dr. Rafael Andrade', 'Dra. Juliana Portela']} />
            <Filter label="Especialidade" options={['Todas', 'Clínica médica', 'Cardiologia', 'Dermatologia']} />
            <Filter label="Unidade" options={['Clínica Cadencia · Jardins']} />
            <Filter label="Tipo" options={['Todos', 'Consulta', 'Retorno', 'Teleconsulta', 'Procedimento']} />
            <Filter label="Status" options={['Todos', 'Confirmado', 'Aguardando', 'Em atendimento']} />
            <Button size="sm" variant="ghost">Limpar filtros</Button>
          </div>
        ) : null}
      </section>

      {view === 'week' ? <WeekCalendar events={events} onSelect={setSelected} /> : view === 'list' ? <AgendaList events={events} onSelect={setSelected} /> : (
        <section className="rounded-xl border border-border bg-surface px-6 py-14 text-center"><p className="font-semibold text-text-primary">Visualização {view === 'day' ? 'diária' : 'mensal'}</p><p className="mt-1 text-sm text-text-secondary">Use a visão semanal para operar a agenda completa ou a lista para uma leitura compacta.</p><Button className="mt-4" onClick={() => setView('week')}>Voltar para semana</Button></section>
      )}

      <CalendarEventDrawer event={selected} onClose={() => setSelected(null)} onReschedule={(event) => { setSelected(null); setReschedule(event); }} />
      <RescheduleDialog event={reschedule} onClose={() => setReschedule(null)} />
    </div>
  );
}

function Filter({ label, options }: { readonly label: string; readonly options: readonly string[] }) {
  return (
    <label className="min-w-[150px] flex-1 sm:max-w-[210px]"><span className="mb-1 block text-[11px] font-semibold text-text-secondary">{label}</span><select className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-brand">{options.map((option) => <option key={option}>{option}</option>)}</select></label>
  );
}

function WeekCalendar({ events, onSelect }: { readonly events: readonly CalendarEventData[]; readonly onSelect: (event: CalendarEventData) => void }) {
  return (
    <section aria-label="Calendário semanal" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
      <div className="overflow-x-auto scrollbar-thin">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[64px_repeat(7,minmax(120px,1fr))] border-b border-border bg-surface-subtle">
            <div className="border-r border-border" />
            {days.map((day) => <div key={day.day} className={cn('border-r border-border px-2 py-3 text-center last:border-r-0', day.day === 11 && 'bg-brand-soft/45')}><span className="block text-[10px] font-bold tracking-[.08em] text-text-tertiary">{day.short}</span><span className={cn('mt-0.5 inline-grid size-7 place-items-center rounded-full text-sm font-bold tabular-nums', day.day === 11 && 'bg-brand text-white')}>{day.day}</span></div>)}
          </div>
          <div className="grid h-[594px] grid-cols-[64px_repeat(7,minmax(120px,1fr))]">
            <div className="relative border-r border-border bg-surface-subtle">
              {hours.map((hour, index) => <time key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-text-tertiary" style={{ top: index * 66 }}>{hour}</time>)}
            </div>
            {days.map((day) => (
              <div key={day.day} className={cn('relative border-r border-border last:border-r-0', day.day === 11 && 'bg-brand-soft/10')}>
                {hours.map((hour, index) => <div key={hour} className="absolute inset-x-0 border-t border-border/70" style={{ top: index * 66 }} />)}
                {events.filter((event) => event.day === day.day - 9).map((event) => <CalendarEvent key={event.id} event={event} onSelect={() => onSelect(event)} />)}
                {day.day === 11 ? <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-danger" style={{ top: 178 }}><span className="absolute -left-1 -top-1 size-2 rounded-full bg-danger" /></div> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border px-4 py-2.5 text-xs text-text-tertiary">Eventos foram estruturados para suportar arrastar e soltar com confirmação antes da alteração.</div>
    </section>
  );
}

function CalendarEvent({ event, onSelect }: { readonly event: CalendarEventData; readonly onSelect: () => void }) {
  const tones = {
    blue: 'border-info/20 bg-info-soft text-info',
    green: 'border-success/20 bg-success-soft text-success',
    amber: 'border-warning/20 bg-warning-soft text-warning',
    violet: 'border-brand/20 bg-brand-soft text-brand',
  } as const;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('absolute inset-x-1.5 z-10 overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-all-fast hover:border-brand hover:shadow-elev-1', tones[event.tone])}
      style={{ top: event.start * 1.1 + 3, height: Math.max(46, event.duration * 1.1 - 6) }}
      aria-label={`${event.time}, ${event.patientName}, ${event.procedure}`}
    >
      <span className="block text-[10px] font-bold tabular-nums">{event.time}</span>
      <span className="mt-0.5 block truncate text-xs font-semibold">{event.shortName}</span>
      <span className="block truncate text-[10px] opacity-80">{event.procedure}</span>
    </button>
  );
}

function AgendaList({ events, onSelect }: { readonly events: readonly CalendarEventData[]; readonly onSelect: (event: CalendarEventData) => void }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-surface">{events.map((event) => <button key={event.id} type="button" onClick={() => onSelect(event)} className="flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface-subtle"><time className="w-12 font-semibold tabular-nums">{event.time}</time><Avatar initials={event.shortName.split(' ').map((part) => part[0]).join('').slice(0, 2)} name={event.patientName} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{event.patientName}</span><span className="block truncate text-xs text-text-secondary">{event.procedure} · {event.professional}</span></span><StatusBadge status={event.status} /></button>)}</section>;
}

function CalendarEventDrawer({ event, onClose, onReschedule }: { readonly event: CalendarEventData | null; readonly onClose: () => void; readonly onReschedule: (event: CalendarEventData) => void }) {
  return (
    <Drawer open={event !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Detalhes do agendamento" description="Contexto rápido da agenda" footer={event ? <div className="grid grid-cols-2 gap-2"><Button iconLeft={ChatCircle}>Mensagem</Button><Button variant="primary">Abrir atendimento</Button><Button onClick={() => onReschedule(event)}>Reagendar</Button><Button className="text-danger">Cancelar</Button></div> : undefined}>
      {event ? <><div className="flex items-center gap-3 pb-5"><Avatar initials={event.shortName.split(' ').map((part) => part[0]).join('').slice(0, 2)} name={event.patientName} size="lg" /><div><h2 className="text-base font-bold">{event.patientName}</h2><p className="text-sm text-text-secondary">{event.time} · {event.duration} min</p></div></div><dl className="grid grid-cols-[110px_1fr] gap-y-3 border-y border-border py-4 text-sm"><dt className="text-text-secondary">Profissional</dt><dd className="font-medium">{event.professional}</dd><dt className="text-text-secondary">Tipo</dt><dd>{event.procedure}</dd><dt className="text-text-secondary">Convênio</dt><dd>{event.insurer}</dd><dt className="text-text-secondary">Status</dt><dd><StatusBadge status={event.status} /></dd></dl></> : null}
    </Drawer>
  );
}

function RescheduleDialog({ event, onClose }: { readonly event: CalendarEventData | null; readonly onClose: () => void }) {
  return <Dialog.Root open={event !== null} onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[79] bg-text-primary/25" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-elev-3"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-lg font-bold">Confirmar reagendamento</Dialog.Title><Dialog.Description className="mt-2 text-sm text-text-secondary">Reagendar {event?.patientName ?? 'paciente'} de {event?.time ?? ''} para 10:30?</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="Fechar" className="grid size-8 place-items-center rounded-lg hover:bg-surface-subtle"><X size={17} /></button></Dialog.Close></div><div className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>Voltar</Button><Button variant="primary" onClick={onClose}>Confirmar reagendamento</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
