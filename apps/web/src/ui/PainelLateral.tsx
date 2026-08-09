'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '@phosphor-icons/react';
import { Icone } from './Icone';
import { cn } from '../lib/cn';

type Largura = 'sm' | 'md' | 'lg';

export interface PainelLateralProps {
  /** Controla visibilidade */
  readonly aberto: boolean;
  /** Callback para fechar (nome novo) */
  readonly onFechar?: () => void;
  /** @deprecated Use `onFechar`. Mantido para compatibilidade. */
  readonly aoFechar?: () => void;
  /** Titulo do painel (renderizado no cabecalho) */
  readonly titulo?: string;
  /** Largura do painel */
  readonly largura?: Largura;
  /** Conteudo do painel */
  readonly children: ReactNode;
  /** Classes adicionais */
  readonly className?: string;
}

const larguraClasses: Record<Largura, string> = {
  sm: 'w-80',
  md: 'w-[420px]',
  lg: 'w-[560px]',
};

export function PainelLateral({
  aberto,
  onFechar,
  aoFechar,
  titulo,
  largura = 'md',
  children,
  className,
}: PainelLateralProps) {
  const fechar = onFechar ?? aoFechar ?? (() => {});

  return (
    <Dialog.Root open={aberto} onOpenChange={(open) => !open && fechar()}>
      <AnimatePresence>
        {aberto && (
          <Dialog.Portal forceMount>
            {/* Overlay com blur */}
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>

            {/* Painel */}
            <Dialog.Content
              asChild
              aria-label={titulo ? undefined : 'Painel lateral'}
            >
              <motion.div
                className={cn(
                  'fixed right-0 top-0 z-50 flex h-full flex-col',
                  'bg-surface/95 backdrop-blur-xl border-l border-line shadow-elev-3',
                  'max-md:w-full',
                  larguraClasses[largura],
                  className,
                )}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              >
                {/* Cabecalho */}
                <div className="flex items-center justify-between border-b border-line px-[var(--s-6)] py-[var(--s-4)]">
                  {titulo && (
                    <Dialog.Title className="text-[length:var(--fs-18)] font-[number:var(--fw-semibold)] text-text">
                      {titulo}
                    </Dialog.Title>
                  )}
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className={cn(
                        'ml-auto rounded-lg border border-transparent p-2',
                        'text-text-muted hover:bg-surface-hover hover:text-text',
                        'transition-colors-fast',
                        'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                      )}
                      aria-label="Fechar painel"
                    >
                      <Icone icon={X} size="md" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Conteudo com scroll */}
                <div className="flex-1 overflow-y-auto p-[var(--s-6)]">
                  {children}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
