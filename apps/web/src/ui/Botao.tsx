'use client';

import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { type Icon as PhosphorIcon, SpinnerGap } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';
export type TamanhoBotao = 'sm' | 'md' | 'lg';
/** @deprecated Use `tamanho` instead */
export type AlturaBotao = 28 | 32 | 40;

export interface BotaoProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variante?: VarianteBotao;
  readonly tamanho?: TamanhoBotao;
  readonly altura?: AlturaBotao;
  readonly iconeEsquerda?: PhosphorIcon;
  readonly iconeDireita?: PhosphorIcon;
  readonly carregando?: boolean;
  readonly fullWidth?: boolean;
  readonly children: ReactNode;
}

const ALTURA_PARA_TAMANHO: Record<AlturaBotao, TamanhoBotao> = {
  28: 'sm',
  32: 'md',
  40: 'lg',
};

const TAMANHO_ICONE: Record<TamanhoBotao, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

const classesVariante: Record<VarianteBotao, string> = {
  primario: 'border border-accent bg-accent text-accent-on hover:border-accent-hover hover:bg-accent-hover',
  secundario: 'border border-line bg-surface text-text hover:border-line-strong hover:bg-surface-subtle',
  fantasma: 'border border-transparent bg-transparent text-text-muted hover:bg-surface-subtle hover:text-text',
  perigo: 'border border-danger bg-danger text-white hover:brightness-95',
};

const classesTamanho: Record<TamanhoBotao, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
};

export function Botao({
  variante = 'primario',
  tamanho,
  altura,
  iconeEsquerda: IconeEsq,
  iconeDireita: IconeDir,
  carregando = false,
  fullWidth = false,
  children,
  disabled,
  className,
  ...resto
}: BotaoProps) {
  const tamanhoResolvido: TamanhoBotao = tamanho ?? (altura ? ALTURA_PARA_TAMANHO[altura] : 'md');
  const tamanhoIcone = TAMANHO_ICONE[tamanhoResolvido];
  const desabilitado = disabled === true || carregando;

  return (
    <button
      type="button"
      {...resto}
      disabled={desabilitado}
      aria-busy={carregando}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-lg font-semibold tracking-[-0.008em]',
        'transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        classesVariante[variante],
        classesTamanho[tamanhoResolvido],
        fullWidth && 'w-full',
        carregando && 'pointer-events-none cursor-progress opacity-70',
        desabilitado && !carregando && 'cursor-not-allowed opacity-50 active:translate-y-0',
        className,
      )}
    >
      {carregando ? (
        <SpinnerGap size={tamanhoIcone} className="shrink-0 animate-spin" aria-hidden data-testid="spinner-carregando" />
      ) : (
        IconeEsq && <IconeEsq size={tamanhoIcone} className="shrink-0" aria-hidden data-testid="icone-esquerda" />
      )}
      {children}
      {IconeDir && <IconeDir size={tamanhoIcone} className="shrink-0" aria-hidden data-testid="icone-direita" />}
      {carregando && <span role="status" className="sr-only">Carregando</span>}
    </button>
  );
}