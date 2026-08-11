'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  readonly footer?: ReactNode | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
}) {
  const widths = { sm: 'max-w-[400px]', md: 'max-w-[460px]', lg: 'max-w-[560px]' } as const;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[79] bg-text-primary/25 backdrop-blur-[1px] data-[state=open]:animate-[fadeIn_160ms_ease-out]" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[80] flex w-[calc(100%-16px)] flex-col border-l border-border bg-surface shadow-elev-3',
            'data-[state=open]:animate-[slideInRight_200ms_var(--ease-out)]',
            widths[size],
          )}
        >
          <header className="flex min-h-16 shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold tracking-tight text-text-primary">{title}</Dialog.Title>
              <Dialog.Description className={description ? 'mt-0.5 text-sm text-text-secondary' : 'sr-only'}>
                {description ?? `Painel lateral: ${title}`}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Fechar painel" className="grid size-9 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors-fast hover:bg-surface-subtle hover:text-text-primary">
                <X size={19} aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">{children}</div>
          {footer ? <footer className="shrink-0 border-t border-border bg-surface px-5 py-4">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
