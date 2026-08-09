'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from './Icone';

export interface BlocoDeSecaoProps {
  readonly titulo: string;
  /** @deprecated Use aberto={false} em vez de vazia */
  readonly vazia?: boolean;
  readonly aberto?: boolean;
  readonly badge?: number;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function BlocoDeSecao({ titulo, vazia = false, aberto: abertoProp, badge, children, className }: BlocoDeSecaoProps) {
  const abertoInicial = abertoProp !== undefined ? abertoProp : !vazia;
  const [aberto, setAberto] = useState(abertoInicial);
  const id = useId();

  return (
    <section className={cn('overflow-hidden rounded-[18px] border border-line/70 bg-surface/62 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_82%,white)]', className)}>
      <button
        type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls={id} style={{ minHeight: 24 }}
        className={cn('group flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-4 py-3 text-left', 'transition-colors duration-[var(--dur-2)] hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', aberto ? 'text-text' : 'text-text-muted')}
      >
        <div className="flex min-w-0 items-center gap-2.5"><span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full transition-all', aberto ? 'bg-accent shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_35%,transparent)]' : 'bg-line-strong')} /><h3 className="m-0 truncate text-[13px] font-semibold tracking-[-.01em]">{titulo}</h3>{badge != null && badge > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-on">{badge}</span>}</div>
        <motion.span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-surface-sunken/55 text-text-faint group-hover:text-text" animate={{ rotate: aberto ? 180 : 0 }} transition={{ duration: .2 }}><Icone icon={CaretDown} size="sm" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div id={id} role="region" aria-label={titulo} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .22, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="border-t border-line/65 px-4 py-4 text-[13px] leading-[var(--lh-read)]">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
