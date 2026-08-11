'use client';

import { cn } from '../../lib/cn';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number;
}

export function Tabs<T extends string>({ items, active, onChange, label, className }: {
  readonly items: readonly TabItem<T>[];
  readonly active: T;
  readonly onChange: (id: T) => void;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex min-w-0 items-center gap-1 overflow-x-auto', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'relative h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors-fast',
            active === item.id
              ? 'bg-brand-soft text-brand'
              : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
          )}
        >
          {item.label}
          {item.count !== undefined ? <span className="ml-1.5 tabular-nums text-[10px] opacity-70">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
