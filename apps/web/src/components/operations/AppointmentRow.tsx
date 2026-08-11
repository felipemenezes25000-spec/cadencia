'use client';

import { WarningCircle } from '@phosphor-icons/react';
import type { Appointment } from '../../domain/appointments/types';
import { getPrimaryAction } from '../../domain/appointments/actions';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { AppointmentActionMenu } from './AppointmentActionMenu';

export function AppointmentRow({ appointment, selected = false, onOpenPatient, onPrimary }: {
  readonly appointment: Appointment;
  readonly selected?: boolean;
  readonly onOpenPatient: () => void;
  readonly onPrimary: () => void;
}) {
  const action = getPrimaryAction(appointment.status);
  return (
    <div className={cn(
      'grid min-h-[72px] grid-cols-[64px_minmax(220px,1.5fr)_76px_minmax(128px,.8fr)_minmax(120px,.72fr)_36px] items-center gap-3 border-b border-border px-4 last:border-b-0',
      'transition-colors-fast hover:bg-surface-subtle',
      selected && 'bg-brand-soft/40',
    )}>
      <time className="text-sm font-semibold tabular-nums text-text-primary">{appointment.time}</time>
      <button type="button" onClick={onOpenPatient} className="flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-offset-4">
        <Avatar initials={appointment.patientInitials} name={appointment.patientName} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-primary">{appointment.patientName}</span>
            {appointment.alert ? <WarningCircle size={14} weight="fill" className="shrink-0 text-danger" aria-label="Paciente com pendência" /> : null}
          </span>
          <span className="block truncate text-xs text-text-secondary">{appointment.procedure} · {appointment.professional}</span>
          <span className="block truncate text-[11px] text-text-tertiary">{appointment.insurer}</span>
        </span>
      </button>
      <span className={cn('text-xs tabular-nums', appointment.waitMinutes !== null && appointment.waitMinutes >= 15 ? 'font-semibold text-warning' : 'text-text-secondary')}>
        {appointment.waitMinutes === null ? '—' : `${appointment.waitMinutes} min`}
      </span>
      <StatusBadge status={appointment.status} />
      <Button size="sm" variant={action.intent === 'clinical' ? 'primary' : 'secondary'} onClick={onPrimary} className="w-full px-2">
        {action.label}
      </Button>
      <AppointmentActionMenu appointment={appointment} onOpenPatient={onOpenPatient} />
    </div>
  );
}
