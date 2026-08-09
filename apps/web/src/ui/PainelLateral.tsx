'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { X, Sparkle } from '@phosphor-icons/react';
import { Icone } from './Icone';
import { cn } from '../lib/cn';

type Largura = 'sm' | 'md' | 'lg';

export interface PainelLateralProps {
  readonly aberto: boolean;
  readonly onFechar?: () => void;
  /** @deprecated Use `onFechar`. */
  readonly aoFechar?: () => void;
  readonly titulo?: string;
  readonly largura?: Largura;
  readonly children: ReactNode;
  readonly className?: string;
}

const larguraClasses: Record<Largura, string> = { sm: 'w-[360px]', md: 'w-[460px]', lg: 'w-[620px]' };

export function PainelLateral({ aberto, onFechar, aoFechar, titulo, largura = 'md', children, className }: PainelLateralProps) {
  const fechar = onFechar ?? aoFechar ?? (() => {});

  return (
    <Dialog.Root open={aberto} onOpenChange={(open) => !open && fechar()}>
      <AnimatePresence>
        {aberto && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-[color-mix(in_oklab,var(--brand-ink)_42%,transparent)] backdrop-blur-[8px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-label={titulo ? undefined : 'Painel lateral'}>
              <motion.div
                className={cn(
                  'fixed bottom-0 right-0 top-0 z-50 flex max-w-full flex-col overflow-hidden border-l border-line/80 bg-surface/96 shadow-[var(--elev-float)] backdrop-blur-2xl',
                  'max-md:top-auto max-md:h-[min(92dvh,820px)] max-md:w-full max-md:rounded-t-[26px] max-md:border-l-0 max-md:border-t',
                  larguraClasses[largura], className,
                )}
                initial={{ x: '104%', opacity: .6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '104%', opacity: .7 }}
                transition={{ type: 'spring', damping: 29, stiffness: 320, mass: .86 }}
              >
                <div className="relative flex min-h-[72px] items-center justify-between overflow-hidden border-b border-line/70 px-5 py-4 sm:px-6">
                  <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-[var(--aurora)] opacity-70" />
                  <div className="min-w-0">
                    <span className="cadencia-eyebrow"><Sparkle size={10} weight="fill" /> painel contextual</span>
                    {titulo ? <Dialog.Title className="m-0 mt-1 truncate text-[17px] font-semibold tracking-[-.025em] text-text">{titulo}</Dialog.Title> : <Dialog.Title className="sr-only">Painel lateral</Dialog.Title>}
                  </div>
                  <Dialog.Close asChild>
                    <motion.button
                      type="button" whileHover={{ rotate: 4, scale: 1.04 }} whileTap={{ scale: .94 }}
                      className="ml-4 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line/80 bg-surface-raised/80 text-text-muted shadow-elev-1 transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="Fechar painel"
                    ><Icone icon={X} size="md" /></motion.button>
                  </Dialog.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
