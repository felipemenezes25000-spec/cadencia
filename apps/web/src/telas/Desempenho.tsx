// apps/web/src/telas/Desempenho.tsx
'use client';

import { useState } from 'react';
import { Explorar, type ExplorarProps } from './Explorar';

type AbaDesempenho = 'explorar' | 'variacoes' | 'atendimentos' | 'satisfacao';

const ABAS: readonly { id: AbaDesempenho; rotulo: string }[] = [
  { id: 'explorar', rotulo: 'Explorar' },
  { id: 'variacoes', rotulo: 'Variacoes do periodo' },
  { id: 'atendimentos', rotulo: 'Atendimentos' },
  { id: 'satisfacao', rotulo: 'Satisfacao' },
];

export type DesempenhoProps = ExplorarProps;

export function Desempenho(p: DesempenhoProps) {
  const [abaAtiva, setAbaAtiva] = useState<AbaDesempenho>('explorar');

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Desempenho
      </h1>

      {/* Sub-navegacao */}
      <div role="tablist" aria-label="Abas do Desempenho"
        style={{ display: 'flex', gap: 'var(--s-1)',
                 borderBottom: '2px solid var(--line)' }}>
        {ABAS.map((aba) => (
          <button key={aba.id} role="tab"
            aria-selected={abaAtiva === aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            style={{
              padding: 'var(--s-3) var(--s-5)',
              fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: abaAtiva === aba.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: abaAtiva === aba.id
                ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {aba.rotulo}
          </button>
        ))}
      </div>

      {/* Conteudo da aba */}
      {abaAtiva === 'explorar' ? (
        <Explorar {...p} />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-14)',
                    padding: 'var(--s-8)' }}>
          Em breve
        </p>
      )}
    </div>
  );
}
