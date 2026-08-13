'use client';

import Link from 'next/link';
import { cn } from '../lib/cn';

export interface ItemNavegacaoDeRotas {
  readonly value: string;
  readonly rotulo: string;
  readonly href: string;
  readonly badge?: number | undefined;
}

export interface NavegacaoDeRotasProps {
  readonly itens: readonly ItemNavegacaoDeRotas[];
  readonly ativa: string;
  readonly rotulo: string;
  readonly className?: string;
  readonly aoNavegar?: (value: string) => void;
}

/** Navega entre rotas irmãs com links reais e estado atual anunciado. */
export function NavegacaoDeRotas({
  itens,
  ativa,
  rotulo,
  className,
  aoNavegar,
}: NavegacaoDeRotasProps) {
  return (
    <nav aria-label={rotulo} className={cn('-mx-1 overflow-x-auto px-1 scrollbar-thin', className)}>
      <div className="cadencia-tabs-list flex min-w-max items-center gap-1 rounded-xl border border-line bg-surface-subtle p-1">
        {itens.map((item) => {
          const atual = item.value === ativa;
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={atual ? 'page' : undefined}
              onClick={() => aoNavegar?.(item.value)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                atual
                  ? 'bg-surface text-text shadow-elev-1'
                  : 'text-text-muted hover:bg-surface/70 hover:text-text',
              )}
            >
              {item.rotulo}
              {item.badge != null && item.badge > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-[11px] font-bold text-accent">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
