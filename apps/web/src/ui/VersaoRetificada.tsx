'use client';

import { useId, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { CaretDown, ArrowCounterClockwise } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from './Icone';

export interface VersaoRetificadaProps {
  readonly versaoNo: number;
  readonly retificadaEm: string;
  readonly autor: string;
  readonly justificativa: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function VersaoRetificada({
  versaoNo,
  retificadaEm,
  autor,
  justificativa,
  children,
  className,
}: VersaoRetificadaProps) {
  const [aberta, setAberta] = useState(false);
  const id = useId();

  return (
    <div
      className={cn(
        'rounded-[var(--r-md)] border border-warn/30 bg-warn-soft/30 mb-[var(--s-5)]',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        aria-controls={id}
        className={cn(
          'flex w-full items-center justify-between',
          'px-[var(--s-4)] py-[var(--s-3)]',
          'border-0 bg-transparent text-left cursor-pointer',
          'text-[length:var(--fs-12)] text-text-muted',
          'hover:bg-warn-soft/20 transition-colors-fast',
          'rounded-[var(--r-md)]',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        )}
      >
        <div className="flex items-center gap-[var(--s-2)]">
          <Icone
            icon={ArrowCounterClockwise}
            size="sm"
            className="text-warn"
          />
          <span className="text-[length:var(--fs-12)] font-medium text-text">
            {`versão ${versaoNo}`}
          </span>
          <span className="text-[length:var(--fs-12)] text-text-muted">
            {`retificada em ${retificadaEm} por ${autor}`}
          </span>
        </div>
        <motion.div
          animate={{ rotate: aberta ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <Icone icon={CaretDown} size="sm" className="text-text-muted" />
        </motion.div>
      </button>

      {aberta && (
        <div id={id} className="border-t border-warn/20 px-[var(--s-4)] py-[var(--s-3)] space-y-[var(--s-3)]">
          <div
            data-testid="conteudo-retificado"
            className="text-text-muted my-[var(--s-4)]"
            style={{
              textDecorationLine: 'line-through',
              textDecorationColor: 'var(--danger)',
            }}
          >
            {children}
          </div>
          <p className="text-[length:var(--fs-12)] text-text-muted m-0">
            <strong>Justificativa:</strong> {justificativa}
          </p>
        </div>
      )}
    </div>
  );
}
