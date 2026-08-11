import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function PageHeader({ title, description, eyebrow, actions, className }: {
  readonly title: string;
  readonly description?: string;
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <header className={cn('flex min-w-0 items-start justify-between gap-5 max-sm:flex-col', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-semibold text-text-secondary">{eyebrow}</div> : null}
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.03em] text-text-primary">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
