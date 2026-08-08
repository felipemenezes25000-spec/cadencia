// apps/web/src/ui/ChipDeStatusTiss.tsx
'use client';

import { cn } from '../lib/cn';

export type StatusTiss =
  | 'rascunho' | 'enviado' | 'processado' | 'glosado'
  | 'completa' | 'incompleta'
  | 'pendente' | 'processando' | 'aprovado' | 'parcial' | 'recurso' | 'pago';

const CHIP: Record<StatusTiss, { rotulo: string; glifo: string; classes: string }> = {
  rascunho:    { rotulo: 'Rascunho',    glifo: '●', classes: 'bg-surface-sunken text-text-muted border border-line' },
  pendente:    { rotulo: 'Pendente',    glifo: '●', classes: 'bg-warn-soft/40 text-warn border border-warn/20' },
  enviado:     { rotulo: 'Enviado',     glifo: '↑', classes: 'bg-accent-soft/40 text-accent border border-accent/20' },
  processando: { rotulo: 'Processando', glifo: '●', classes: 'bg-accent-soft/40 text-accent border border-accent/20' },
  processado:  { rotulo: 'Processado',  glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  aprovado:    { rotulo: 'Aprovado',    glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  glosado:     { rotulo: 'Glosado',     glifo: '!', classes: 'bg-danger-soft/40 text-danger border border-danger/20' },
  parcial:     { rotulo: 'Parcial',     glifo: '●', classes: 'bg-warn-soft/40 text-warn border border-warn/20' },
  recurso:     { rotulo: 'Em recurso',  glifo: '●', classes: 'bg-accent-soft/40 text-accent border border-accent/20' },
  completa:    { rotulo: 'Completa',    glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
  incompleta:  { rotulo: 'Incompleta',  glifo: '!', classes: 'bg-warn-soft/40 text-warn border border-warn/20' },
  pago:        { rotulo: 'Pago',        glifo: '✓', classes: 'bg-ok-soft/40 text-ok border border-ok/20' },
};

export interface ChipDeStatusTissProps {
  readonly status: StatusTiss;
  readonly className?: string;
}

export function ChipDeStatusTiss({ status, className }: ChipDeStatusTissProps) {
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

export { CHIP as CHIPS_TISS };
