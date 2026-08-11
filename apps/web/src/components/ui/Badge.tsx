import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-subtle text-text-secondary ring-border',
  brand: 'bg-brand-soft text-brand ring-brand/15',
  info: 'bg-info-soft text-info ring-info/15',
  success: 'bg-success-soft text-success ring-success/15',
  warning: 'bg-warning-soft text-warning ring-warning/15',
  danger: 'bg-danger-soft text-danger ring-danger/15',
};

export function Badge({ children, tone = 'neutral', className }: {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  readonly className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex min-h-5 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset',
      toneClasses[tone],
      className,
    )}>
      {children}
    </span>
  );
}
