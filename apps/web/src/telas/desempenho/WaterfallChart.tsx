// apps/web/src/telas/desempenho/WaterfallChart.tsx
'use client';

import type { WaterfallFactor } from './types';

export interface WaterfallChartProps {
  readonly factors: readonly WaterfallFactor[];
  readonly onFactorClick: (factorId: string) => void;
}

const BAR_HEIGHT = 28;
const GAP = 6;
const LABEL_WIDTH = 220;
const VALUE_WIDTH = 100;

export function WaterfallChart({ factors, onFactorClick }: WaterfallChartProps) {
  const maxAbs = Math.max(...factors.map((f) => Math.abs(f.valueCents)), 1);
  const chartWidth = 300;
  const totalHeight = factors.length * (BAR_HEIGHT + GAP);

  function formatValue(cents: number): string {
    const abs = Math.abs(cents);
    const reais = Math.trunc(abs / 100);
    const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${cents < 0 ? '-' : '+'}R$ ${grouped}`;
  }

  return (
    <div role="table" aria-label="Decomposicao em fatores">
      <div role="rowgroup">
        {factors.map((f) => {
          const barWidth = Math.max((Math.abs(f.valueCents) / maxAbs) * chartWidth, 4);
          const isNegative = f.valueCents < 0;

          return (
            <div key={f.factorId} role="row"
              style={{
                display: 'grid',
                gridTemplateColumns: `${LABEL_WIDTH}px ${chartWidth}px ${VALUE_WIDTH}px`,
                alignItems: 'center',
                gap: 'var(--s-3)',
                marginBottom: `${GAP}px`,
                minHeight: `${BAR_HEIGHT}px`,
              }}>
              <div role="cell">
                <button
                  type="button"
                  onClick={() => onFactorClick(f.factorId)}
                  aria-label={`${f.label}`}
                  style={{
                    background: 'transparent', border: 0, cursor: 'pointer',
                    textAlign: 'left', padding: 0,
                    fontSize: 'var(--fs-13)', color: 'var(--text)',
                    fontWeight: 'var(--fw-medium)',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--line)',
                    textUnderlineOffset: '2px',
                  }}>
                  {f.label}
                </button>
              </div>
              <div role="cell"
                style={{ position: 'relative', height: `${BAR_HEIGHT}px` }}>
                <div
                  role="img"
                  aria-label={`${f.label}: ${formatValue(f.valueCents)}`}
                  style={{
                    position: 'absolute',
                    left: isNegative ? `${chartWidth / 2 - barWidth}px` : `${chartWidth / 2}px`,
                    top: 0,
                    width: `${barWidth}px`,
                    height: '100%',
                    borderRadius: 'var(--r-sm)',
                    background: isNegative ? 'var(--danger)' : 'var(--ok)',
                    opacity: 0.8,
                  }}
                />
              </div>
              <span role="cell"
                className="num"
                style={{
                  fontSize: 'var(--fs-13)',
                  fontWeight: 'var(--fw-medium)',
                  color: isNegative ? 'var(--danger)' : 'var(--ok)',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {formatValue(f.valueCents)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
