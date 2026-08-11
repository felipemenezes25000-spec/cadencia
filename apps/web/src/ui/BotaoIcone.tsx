'use client';

import type { ButtonHTMLAttributes } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

export interface BotaoIconeProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icone: PhosphorIcon;
  readonly rotulo: string;
  readonly tamanho?: 'sm' | 'md';
  readonly variante?: 'contorno' | 'fantasma';
}

export function BotaoIcone({
  icone: Icone,
  rotulo,
  tamanho = 'md',
  variante = 'contorno',
  className,
  ...props
}: BotaoIconeProps) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-lg text-text-muted transition-colors-fast disabled:cursor-not-allowed disabled:opacity-50',
        variante === 'contorno'
          ? 'border border-line bg-surface hover:border-line-strong hover:bg-surface-subtle hover:text-text'
          : 'border border-transparent bg-transparent hover:bg-surface-subtle hover:text-text',
        tamanho === 'sm' ? 'size-8' : 'size-9',
        className,
      )}
      {...props}
    >
      <Icone size={tamanho === 'sm' ? 16 : 18} aria-hidden />
    </button>
  );
}
