'use client';

import { cn } from '../lib/cn';
import { APPOINTMENT_STATUS } from '../domain/appointments/states';
import type { AppointmentStatus } from '../domain/appointments/types';

export type StatusAgenda =
  | AppointmentStatus
  | 'em_atendimento' | 'pendente' | 'pago' | 'vencido';

const CHIP: Record<StatusAgenda, { rotulo: string; glifo: string; classes: string }> = {
  agendado:        { rotulo: APPOINTMENT_STATUS.agendado.label,   glifo: '◷', classes: 'bg-surface-sunken text-st-agendado border border-line' },
  confirmado:      { rotulo: APPOINTMENT_STATUS.confirmado.label, glifo: '✓', classes: 'bg-ok-soft/60 text-ok border border-ok/20' },
  aguardando:      { rotulo: APPOINTMENT_STATUS.aguardando.label, glifo: '◷', classes: 'bg-warn-soft/60 text-warn border border-warn/20' },
  atendendo:       { rotulo: APPOINTMENT_STATUS.atendendo.label,  glifo: '▶', classes: 'bg-accent-soft/70 text-accent border border-accent/20' },
  em_atendimento:  { rotulo: APPOINTMENT_STATUS.atendendo.label,  glifo: '▶', classes: 'bg-accent-soft/70 text-accent border border-accent/20' },
  atendido:        { rotulo: APPOINTMENT_STATUS.atendido.label,   glifo: '✓', classes: 'bg-ok-soft/60 text-ok border border-ok/20' },
  faltou:          { rotulo: APPOINTMENT_STATUS.faltou.label,     glifo: '✕', classes: 'bg-danger-soft/60 text-danger border border-danger/20' },
  cancelado:       { rotulo: APPOINTMENT_STATUS.cancelado.label,  glifo: '✕', classes: 'bg-surface-sunken text-text-muted border border-line' },
  pendente:        { rotulo: 'Pendente',        glifo: '●', classes: 'bg-warn-soft/40 text-warn border border-warn/20' },
  pago:            { rotulo: 'Pago',            glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  vencido:         { rotulo: 'Vencido',         glifo: '✕', classes: 'bg-danger-soft/40 text-danger border border-danger/20' },
};

export interface ChipDeStatusProps {
  readonly status: StatusAgenda;
  readonly className?: string;
}

export function ChipDeStatus({ status, className }: ChipDeStatusProps) {
  const c = CHIP[status] ?? {
    rotulo: status,
    glifo: '●',
    classes: 'bg-surface-sunken text-text-muted border border-line',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[var(--s-2)]',
        'text-[10px] font-bold tracking-[-0.005em]',
        'px-2.5 py-1.5',
        'rounded-full shadow-[inset_0_1px_0_rgb(255_255_255_/_0.55)]',
        c.classes,
        className,
      )}
    >
      <span aria-hidden="true">{c.glifo}</span>
      {c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_DE_STATUS };
