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
  /** Variante visual */
  readonly variante?: VarianteBotao;
  /** Tamanho */
  readonly tamanho?: TamanhoBotao;
  /** @deprecated Use `tamanho` instead. Mantido para compatibilidade. */
  readonly altura?: AlturaBotao;
  /** Icone a esquerda */
  readonly iconeEsquerda?: PhosphorIcon;
  /** Icone a direita */
  readonly iconeDireita?: PhosphorIcon;
  /** Estado de carregamento */
  readonly carregando?: boolean;
  /** Largura total do container */
  readonly fullWidth?: boolean;
  /** Conteudo */
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
  primario: 'bg-accent text-accent-on hover:brightness-110',
  secundario: 'bg-surface border border-line text-text hover:bg-surface-raised',
  fantasma: 'bg-transparent text-text hover:bg-surface-raised',
  perigo: 'bg-danger text-white hover:brightness-110',
};

const classesTamanho: Record<TamanhoBotao, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
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
  const tamanhoResolvido: TamanhoBotao =
    tamanho ?? (altura ? ALTURA_PARA_TAMANHO[altura] : 'md');
  const tamanhoIcone = TAMANHO_ICONE[tamanhoResolvido];
  const desabilitado = disabled === true || carregando;

  const tapAnimation = desabilitado ? {} : { whileTap: { scale: 0.97 } };

  return (
    // @ts-expect-error -- exactOptionalPropertyTypes conflict between ButtonHTMLAttributes spread and motion's HTMLMotionProps
    <motion.button
      type="button"
      {...resto}
      disabled={desabilitado}
      aria-busy={carregando}
      {...tapAnimation}
      transition={{ duration: 0.1 }}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-md',
        'transition-colors-fast',
        classesVariante[variante],
        classesTamanho[tamanhoResolvido],
        fullWidth && 'w-full',
        carregando && 'pointer-events-none opacity-70 cursor-progress',
        desabilitado && !carregando && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {carregando ? (
        <SpinnerGap
          size={tamanhoIcone}
          className="shrink-0 animate-spin"
          aria-hidden
          data-testid="spinner-carregando"
        />
      ) : (
        IconeEsq && (
          <IconeEsq
            size={tamanhoIcone}
            className="shrink-0"
            aria-hidden
            data-testid="icone-esquerda"
          />
        )
      )}
      {children}
      {IconeDir && (
        <IconeDir
          size={tamanhoIcone}
          className="shrink-0"
          aria-hidden
          data-testid="icone-direita"
        />
      )}
      {carregando && (
        <span role="status" className="sr-only">
          Carregando
        </span>
      )}
    </motion.button>
  );
}
