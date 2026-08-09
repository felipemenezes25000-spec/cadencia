'use client';

import { useEffect, useRef } from 'react';
import { useMotionValue, useTransform, animate } from 'motion/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

/* ── Interface generica (nova) ──────────────────────────────────────── */

export interface Contador {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: number;
  /** Cor do indicador (optional, maps to token) */
  readonly cor?: 'destaque' | 'sucesso' | 'erro' | 'aviso' | 'info';
}

/* ── Interface legada (backward compat) ─────────────────────────────── */

export interface Contadores {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export type FiltroDoDia = keyof Contadores;

/* ── Props — suporta ambas as interfaces ────────────────────────────── */

interface FaixaNovaProps {
  readonly contadores: Contador[];
  /** ID do contador ativo (filtro selecionado) */
  readonly ativo?: string;
  /** Callback quando um contador e clicado */
  readonly onClicar?: (id: string) => void;
  /** Classes adicionais */
  readonly className?: string;
}

interface FaixaLegadaProps {
  readonly contadores: Contadores;
  readonly aoFiltrar: (filtro: FiltroDoDia) => void;
  readonly filtroAtivo?: FiltroDoDia;
  readonly className?: string;
}

export type FaixaDeContadoresProps = FaixaNovaProps | FaixaLegadaProps;

/* ── Constantes ─────────────────────────────────────────────────────── */

const ROTULOS_LEGADO: Record<FiltroDoDia, string> = {
  agendados: 'Agendados',
  confirmados: 'Confirmados',
  aguardando: 'Aguardando',
  atendidos: 'Atendidos',
  faltas: 'Faltas',
};

const corClasses: Record<string, string> = {
  destaque: 'bg-accent',
  sucesso: 'bg-ok',
  erro: 'bg-danger',
  aviso: 'bg-warn',
  info: 'bg-accent',
};

/* ── AnimatedNumber ─────────────────────────────────────────────────── */

function AnimatedNumber({
  value,
  className,
}: {
  readonly value: number;
  readonly className?: string;
}) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.8,
      ease: 'easeOut',
    });
    return controls.stop;
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (v) => {
      if (ref.current) ref.current.textContent = String(v);
    });
    return unsubscribe;
  }, [rounded]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function isLegadaProps(
  props: FaixaDeContadoresProps,
): props is FaixaLegadaProps {
  return !Array.isArray(props.contadores);
}

/* ── FaixaDeContadores ──────────────────────────────────────────────── */

export function FaixaDeContadores(props: FaixaDeContadoresProps) {
  let contadores: Contador[];
  let ativo: string | undefined;
  let handleClicar: ((id: string) => void) | undefined;

  if (isLegadaProps(props)) {
    const chaves = Object.keys(ROTULOS_LEGADO) as FiltroDoDia[];
    contadores = chaves.map((k) => ({
      id: k,
      rotulo: ROTULOS_LEGADO[k],
      valor: props.contadores[k],
    }));
    ativo = props.filtroAtivo;
    handleClicar = (id) => props.aoFiltrar(id as FiltroDoDia);
  } else {
    contadores = props.contadores;
    ativo = props.ativo;
    handleClicar = props.onClicar;
  }

  return (
    <RadixTooltip.Provider delayDuration={300}>
      <div
        role="group"
        aria-label="Contadores do dia"
        aria-live="polite"
        className={cn(
          'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5',
          props.className,
        )}
      >
        {contadores.map((c) => (
          <Tooltip key={c.id} conteudo={c.rotulo}>
            <button
              type="button"
              onClick={() => handleClicar?.(c.id)}
              aria-pressed={ativo === c.id}
              className={cn(
                'cadencia-metric group relative flex min-h-[94px] flex-col items-start justify-center gap-1 overflow-hidden p-4 text-left',
                'cursor-pointer focus-visible:shadow-[var(--focus-ring)]',
                ativo === c.id
                  ? 'border-accent/35 bg-accent-soft ring-1 ring-accent/10'
                  : 'hover:bg-surface-raised',
              )}
            >
              <AnimatedNumber
                value={c.valor}
                className="relative z-[1] text-[26px] font-semibold leading-none tracking-[-0.055em] text-text tabular-nums"
              />
              <span className="relative z-[1] text-[10px] font-bold uppercase tracking-[.095em] text-text-muted">{c.rotulo}</span>
              <span aria-hidden className={cn('absolute right-3 top-3 h-2 w-2 rounded-full opacity-70', c.id === 'faltas' ? 'bg-danger' : c.id === 'atendidos' ? 'bg-ok' : c.id === 'aguardando' ? 'bg-warn' : 'bg-accent')} />
              {c.cor && (
                <div
                  className={cn('h-0.5 w-8 rounded-full mt-1', corClasses[c.cor])}
                />
              )}
            </button>
          </Tooltip>
        ))}
      </div>
    </RadixTooltip.Provider>
  );
}
