'use client';

import { useId, useState, type ReactNode } from 'react';

export interface VersaoRetificadaProps {
  readonly versaoNo: number;
  readonly retificadaEm: string;
  readonly autor: string;
  readonly justificativa: string;
  readonly children: ReactNode;
}

export function VersaoRetificada({
  versaoNo, retificadaEm, autor, justificativa, children,
}: VersaoRetificadaProps) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: 'var(--border)',
      borderRadius: 'var(--r-md)', padding: `var(--s-4) var(--s-5)`,
      marginBlockEnd: 'var(--s-5)',
    }}>
      <button
        type="button" onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta} aria-controls={id}
        style={{
          border: 0, background: 'transparent', padding: 0, minHeight: 24,
          color: 'var(--text-muted)', fontSize: 'var(--fs-12)', cursor: 'pointer',
          textAlign: 'left', width: '100%',
        }}
      >
        {`⟨ versão ${versaoNo} · retificada em ${retificadaEm} por ${autor} ⟩ ${aberta ? '▾' : '▸'}`}
      </button>
      {aberta ? (
        <div id={id}>
          <div
            data-testid="conteudo-retificado"
            style={{
              color: 'var(--text-muted)',
              textDecorationLine: 'line-through',
              textDecorationColor: 'var(--danger)',
              marginBlock: 'var(--s-4)',
            }}
          >
            {children}
          </div>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)', margin: 0 }}>
            <strong>Justificativa:</strong> {justificativa}
          </p>
        </div>
      ) : null}
    </div>
  );
}
