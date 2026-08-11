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
  /** Descricao acessivel e contexto curto abaixo do titulo */
  readonly descricao?: string;
  /** Largura do painel */
  readonly largura?: Largura;
  /** Conteudo do painel */
  readonly children: ReactNode;
  /** Acoes persistentes no rodape */
  readonly rodape?: ReactNode;
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
  descricao,
  largura = 'md',
  children,
  rodape,
  className,
}: PainelLateralProps) {
  const fechar = onFechar ?? aoFechar ?? (() => {});

  return (
    <Dialog.Root open={aberto} onOpenChange={(open) => !open && fechar()}>
      <AnimatePresence>
        {aberto && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-text/25"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>

            <Dialog.Content
              asChild
              aria-label={titulo ? undefined : 'Painel lateral'}
            >
              <motion.div
                className={cn(
                  'fixed right-0 top-0 z-50 flex h-full flex-col',
                  'border-l border-line bg-surface shadow-elev-3',
                  'max-md:w-[calc(100%-16px)]',
                  larguraClasses[largura],
                  className,
                )}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex min-h-16 items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    {titulo && (
                      <Dialog.Title className="text-lg font-bold tracking-tight text-text">
                        {titulo}
                      </Dialog.Title>
                    )}
                    <Dialog.Description className={descricao ? 'mt-0.5 text-sm text-text-muted' : 'sr-only'}>
                      {descricao ?? `Painel lateral: ${titulo ?? 'detalhes'}`}
                    </Dialog.Description>
                  </div>
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

                <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
                  {children}
                </div>
                {rodape ? <footer className="shrink-0 border-t border-line bg-surface px-5 py-4">{rodape}</footer> : null}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
