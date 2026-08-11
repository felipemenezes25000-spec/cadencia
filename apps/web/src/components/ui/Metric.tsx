import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';

export function Metric({ value, label, detail, icon: Icon, tone = 'brand', active = false }: {
  readonly value: string | number;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: PhosphorIcon;
  readonly tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  readonly active?: boolean;
}) {
  const iconTone = {
    brand: 'bg-brand-soft text-brand',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    neutral: 'bg-surface-subtle text-text-secondary',
  } as const;
  return (
    <div className={cn(
      'flex min-h-[76px] min-w-0 items-center gap-3 border-r border-border px-4 last:border-r-0 max-sm:border-b max-sm:border-r-0 max-sm:last:border-b-0',
      active && 'bg-brand-soft/40',
    )}>
      {Icon ? <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', iconTone[tone])}><Icon size={19} aria-hidden /></span> : null}
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none tabular-nums text-text-primary">{value}</div>
        <div className="mt-1 truncate text-xs font-semibold text-text-secondary">{label}</div>
        {detail ? <div className="mt-0.5 truncate text-[11px] text-text-tertiary">{detail}</div> : null}
      </div>
    </div>
  );
}
