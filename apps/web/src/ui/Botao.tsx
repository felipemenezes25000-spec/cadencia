'use client';

import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { type Icon as PhosphorIcon, SpinnerGap } from '@phosphor-icons/react';
import { motion } from 'motion/react';
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

const TAMANHO_ICONE: Record<TamanhoBotao, number> = { sm: 14, md: 16, lg: 18 };

const classesVariante: Record<VarianteBotao, string> = {
  primario: [
    'border border-accent/70 bg-[linear-gradient(135deg,var(--accent),color-mix(in_oklab,var(--accent)_82%,var(--brand-violet)))] text-accent-on',
    'shadow-[0_10px_26px_color-mix(in_oklab,var(--accent)_24%,transparent),inset_0_1px_0_oklch(100%_0_0_/_0.28)]',
    'hover:brightness-[1.045] hover:shadow-[0_14px_34px_color-mix(in_oklab,var(--accent)_30%,transparent),inset_0_1px_0_oklch(100%_0_0_/_0.3)]',
  ].join(' '),
  secundario: [
    'border border-line bg-surface/90 text-text shadow-elev-1',
    'hover:border-[color-mix(in_oklab,var(--accent)_22%,var(--line))] hover:bg-surface-raised hover:shadow-elev-2',
  ].join(' '),
  fantasma: 'border border-transparent bg-transparent text-text hover:border-line/70 hover:bg-surface-hover',
  perigo: 'border border-danger/70 bg-danger text-white shadow-[0_9px_24px_color-mix(in_oklab,var(--danger)_20%,transparent)] hover:brightness-105',
};

const classesTamanho: Record<TamanhoBotao, string> = {
  sm: 'min-h-8 px-2.5 text-xs gap-1.5 rounded-[10px]',
  md: 'min-h-9 px-3.5 text-[13px] gap-2 rounded-[11px]',
  lg: 'min-h-11 px-4.5 text-sm gap-2 rounded-[13px]',
};

export function Botao({
  variante = 'primario', tamanho, altura, iconeEsquerda: IconeEsq,
  iconeDireita: IconeDir, carregando = false, fullWidth = false,
  children, disabled, className, ...resto
}: BotaoProps) {
  const tamanhoResolvido = tamanho ?? (altura ? ALTURA_PARA_TAMANHO[altura] : 'md');
  const tamanhoIcone = TAMANHO_ICONE[tamanhoResolvido];
  const desabilitado = disabled === true || carregando;

  return (
    // @ts-expect-error exactOptionalPropertyTypes conflict between native and motion props
    <motion.button
      type="button"
      {...resto}
      disabled={desabilitado}
      aria-busy={carregando}
      whileTap={desabilitado ? undefined : { scale: 0.965 }}
      whileHover={desabilitado ? undefined : { y: -1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative isolate inline-flex items-center justify-center overflow-hidden font-semibold tracking-[-0.01em] select-none',
        'transition-[background,border-color,color,box-shadow,filter,opacity] duration-[var(--dur-2)] ease-[var(--ease-out)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        classesVariante[variante], classesTamanho[tamanhoResolvido],
        fullWidth && 'w-full',
        carregando && 'pointer-events-none cursor-progress opacity-75',
        desabilitado && !carregando && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      {variante === 'primario' && (
        <span aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/45" />
      )}
      {carregando ? (
        <SpinnerGap size={tamanhoIcone} className="shrink-0 animate-spin" aria-hidden data-testid="spinner-carregando" />
      ) : IconeEsq ? (
        <IconeEsq size={tamanhoIcone} className="shrink-0" aria-hidden data-testid="icone-esquerda" />
      ) : null}
      <span className="relative z-[1]">{children}</span>
      {IconeDir && <IconeDir size={tamanhoIcone} className="relative z-[1] shrink-0" aria-hidden data-testid="icone-direita" />}
      {carregando && <span role="status" className="sr-only">Carregando</span>}
    </motion.button>
  );
}
