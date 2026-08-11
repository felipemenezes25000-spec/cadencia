'use client';

import type { Appointment } from '../../domain/appointments/types';
import { getPrimaryAction } from '../../domain/appointments/actions';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { AppointmentActionMenu } from './AppointmentActionMenu';

export function AppointmentCard({ appointment, onOpenPatient, onPrimary }: {
  readonly appointment: Appointment;
  readonly onOpenPatient: () => void;
  readonly onPrimary: () => void;
}) {
  const action = getPrimaryAction(appointment.status);
  return (
    <article className="border-b border-border p-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <time className="w-11 shrink-0 pt-1 text-sm font-bold tabular-nums text-text-primary">{appointment.time}</time>
        <button type="button" onClick={onOpenPatient} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left">
          <Avatar initials={appointment.patientInitials} name={appointment.patientName} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">{appointment.patientName}</span>
            <span className="block truncate text-xs text-text-secondary">{appointment.procedure} · {appointment.insurer}</span>
          </span>
        </button>
        <AppointmentActionMenu appointment={appointment} onOpenPatient={onOpenPatient} />
      </div>
      <div className="mt-4 flex items-center gap-2 pl-14">
        <StatusBadge status={appointment.status} />
        <span className="ml-auto text-xs tabular-nums text-text-secondary">{appointment.waitMinutes === null ? '' : `${appointment.waitMinutes} min de espera`}</span>
      </div>
      <div className="mt-3 flex justify-end pl-14">
        <Button size="sm" variant={action.intent === 'clinical' ? 'primary' : 'secondary'} onClick={onPrimary}>{action.label}</Button>
      </div>
    </article>
  );
}
