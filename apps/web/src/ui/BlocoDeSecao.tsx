'use client';

import { useId, useState, type ReactNode } from 'react';

export interface BlocoDeSecaoProps {
  readonly titulo: string;
  readonly vazia?: boolean;
  readonly children?: ReactNode;
}

export function BlocoDeSecao({ titulo, vazia = false, children }: BlocoDeSecaoProps) {
  const [aberta, setAberta] = useState(!vazia);
  const id = useId();

  if (!aberta) {
    return (
      <button
        type="button" onClick={() => setAberta(true)} aria-expanded={false} aria-controls={id}
        style={{
          display: 'block', width: '100%', textAlign: 'left', minHeight: 24,
          border: 0, background: 'transparent', color: 'var(--text-faint)',
          fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
          letterSpacing: '.01em', padding: 0, cursor: 'pointer',
        }}
      >
        {titulo}
      </button>
    );
  }

  return (
    <section id={id} aria-label={titulo} style={{ marginBlockEnd: 'var(--s-8)' }}>
      <h3 style={{
        fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', lineHeight: 1.3,
        letterSpacing: '.01em', margin: 0, paddingBottom: 'var(--s-3)',
        borderBottom: '1px solid var(--line)',
      }}>
        {titulo}
      </h3>
      <div style={{ paddingTop: 'var(--s-5)', fontSize: 'var(--fs-15)',
                    lineHeight: 'var(--lh-read)' }}>
        {children}
      </div>
    </section>
  );
}
