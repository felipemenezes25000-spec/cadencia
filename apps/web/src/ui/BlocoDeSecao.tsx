'use client';

import { useId, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
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

export function BlocoDeSecao({
  titulo,
  vazia = false,
  aberto: abertoProp,
  badge,
  children,
  className,
}: BlocoDeSecaoProps) {
  // aberto prop takes precedence; if not provided, infer from vazia
  const abertoInicial = abertoProp !== undefined ? abertoProp : !vazia;
  const [aberto, setAberto] = useState(abertoInicial);
  const id = useId();

  return (
    <section
      className={cn('cadencia-section-block mb-[var(--s-8)]', className)}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={id}
        style={{ minHeight: 24 }}
        className={cn(
          'flex w-full items-center justify-between',
          'border-0 bg-transparent text-left cursor-pointer p-0',
          'text-[length:var(--fs-15)] font-semibold tracking-[.01em]',
          'hover:text-accent transition-colors-fast',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
          'rounded-[var(--r-sm)]',
          aberto ? 'text-text' : 'text-text-faint',
        )}
      >
        <div className="flex items-center gap-[var(--s-2)]">
          <h3 className="text-[length:var(--fs-15)] font-semibold leading-[1.3] tracking-[.01em] m-0">
            {titulo}
          </h3>
          {badge != null && badge > 0 && (
            <span
              className={cn(
                'flex h-5 min-w-[20px] items-center justify-center',
                'rounded-full bg-accent px-1.5',
                'text-[length:10px] font-bold text-accent-on',
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: aberto ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <Icone icon={CaretDown} size="sm" className="text-text-muted" />
        </motion.div>
      </button>

      {aberto && (
        <div
          id={id}
          role="region"
          aria-label={titulo}
        >
          <div
            className={cn(
              'pt-[var(--s-5)] text-[length:var(--fs-15)] leading-[var(--lh-read)]',
              'border-t border-line mt-[var(--s-3)]',
            )}
          >
            {children}
          </div>
        </div>
      )}
    </section>
  );
}
