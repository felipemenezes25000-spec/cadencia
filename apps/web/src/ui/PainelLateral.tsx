'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface PainelLateralProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
}

const FOCAVEIS = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function PainelLateral({ aberto, titulo, aoFechar, children }: PainelLateralProps) {
  const id = useId();
  const painel = useRef<HTMLDivElement>(null);
  const origem = useRef<Element | null>(null);

  useEffect(() => {
    if (!aberto) return;
    origem.current = document.activeElement;
    painel.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();

    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); aoFechar(); return; }
      if (e.key !== 'Tab') return;
      const alvos = painel.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
      if (alvos === undefined || alvos.length === 0) return;
      const primeiro = alvos[0]!;
      const ultimo = alvos[alvos.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      (origem.current as HTMLElement | null)?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <>
      <div
        data-testid="fundo-escurecido" onClick={aoFechar} aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          background: 'oklch(0% 0 0 / .08)',
          zIndex: 'var(--z-panel)' as unknown as number,
        }}
      />
      <div
        ref={painel} role="dialog" aria-modal="true" aria-labelledby={id}
        style={{
          position: 'fixed', insetBlock: 0, insetInlineEnd: 0, width: '420px',
          background: 'var(--surface)', borderInlineStart: 'var(--border)',
          boxShadow: 'var(--elev-2)', padding: 'var(--s-6)', overflowY: 'auto',
          zIndex: 'var(--z-panel)' as unknown as number,
          animation: `entra-painel var(--dur-2) var(--ease-out)`,
        }}
      >
        <h2 id={id} style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                             marginTop: 0 }}>
          {titulo}
        </h2>
        {children}
      </div>
    </>
  );
}
