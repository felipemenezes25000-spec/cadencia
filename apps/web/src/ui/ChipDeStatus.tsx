'use client';

import { cn } from '../lib/cn';

export type StatusAgenda =
  | 'agendado' | 'confirmado' | 'aguardando' | 'atendendo'
  | 'atendido' | 'faltou' | 'cancelado'
  | 'em_atendimento' | 'pendente' | 'pago' | 'vencido';

const CHIP: Record<StatusAgenda, { rotulo: string; glifo: string; classes: string }> = {
  agendado:        { rotulo: 'Agendado',        glifo: '●', classes: 'bg-surface-sunken text-st-agendado' },
  confirmado:      { rotulo: 'Confirmado',      glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  aguardando:      { rotulo: 'Aguardando',      glifo: '⏱', classes: 'bg-warn-soft/40 text-warn border border-warn/20' },
  atendendo:       { rotulo: 'Atendendo',       glifo: '●', classes: 'bg-accent-soft/40 text-accent border border-accent/20' },
  em_atendimento:  { rotulo: 'Em atendimento',  glifo: '●', classes: 'bg-accent-soft/40 text-accent border border-accent/20' },
  atendido:        { rotulo: 'Atendido',        glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  faltou:          { rotulo: 'Faltou',          glifo: '✕', classes: 'bg-danger-soft/40 text-danger border border-danger/20' },
  cancelado:       { rotulo: 'Cancelado',       glifo: '✕', classes: 'bg-surface-sunken text-text-muted border border-line' },
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
        'text-[length:var(--fs-11)] uppercase tracking-[.04em] font-medium',
        'px-[var(--s-4)] py-[var(--s-1)]',
        'rounded-full',
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
