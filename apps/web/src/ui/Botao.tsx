'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma';
export type AlturaBotao = 28 | 32 | 40;

export interface BotaoProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variante?: VarianteBotao;
  readonly altura?: AlturaBotao;
  readonly carregando?: boolean;
  readonly children: ReactNode;
}

const ESTILO: Record<VarianteBotao, React.CSSProperties> = {
  primario:   { background: 'var(--accent)', color: 'var(--accent-on)', border: '1px solid transparent' },
  secundario: { background: 'var(--surface)', color: 'var(--text)', border: 'var(--border)' },
  fantasma:   { background: 'transparent', color: 'var(--text)', border: '1px solid transparent' },
};

export function Botao({
  variante = 'primario', altura = 32, carregando = false, children, disabled, ...resto
}: BotaoProps) {
  return (
    <button
      type="button"
      {...resto}
      disabled={disabled === true || carregando}
      aria-busy={carregando}
      style={{
        position: 'relative', overflow: 'hidden',
        minHeight: `${altura}px`, padding: `0 var(--s-5)`,
        borderRadius: 'var(--r-md)', fontWeight: 'var(--fw-medium)',
        fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
        cursor: carregando ? 'progress' : 'pointer',
        ...ESTILO[variante], ...resto.style,
      }}
    >
      {children}
      {carregando ? (
        <>
          <span role="status" aria-label="Carregando" />
          <span
            data-testid="barra-progresso"
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
              background: 'currentColor', opacity: 0.55,
              animation: `barra-indeterminada var(--dur-3) var(--ease-in-out) infinite alternate`,
            }}
          />
        </>
      ) : null}
    </button>
  );
}
