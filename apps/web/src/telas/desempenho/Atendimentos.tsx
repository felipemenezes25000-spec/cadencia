// apps/web/src/telas/desempenho/Atendimentos.tsx
'use client';

import { useEffect, useState } from 'react';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

interface AtendimentoTotals {
  readonly count: number;
  readonly valueCents: number;
}

export interface AtendimentosProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    rows: AtendimentoRow[];
    freshness: DataFreshness;
    totals: AtendimentoTotals;
  }>;
}

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

export function Atendimentos(p: AtendimentosProps) {
  const [rows, setRows] = useState<AtendimentoRow[]>([]);
  const [totals, setTotals] = useState<AtendimentoTotals | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados().then((r) => {
      setRows(r.rows);
      setTotals(r.totals);
      setFreshness(r.freshness);
    });
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Atendimentos
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      <section aria-label="Tabela de atendimentos" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              {['Profissional', 'Procedimento'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
              {['Qtd', 'Valor', 'Duracao media'].map((h) => (
                <th key={h} style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.professionalName}
                </td>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.procedureName}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{formatCents(r.valueCents)}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.avgDurationMin} min</td>
              </tr>
            ))}
          </tbody>
          {totals !== null ? (
            <tfoot>
              <tr>
                <td colSpan={2} style={{
                  padding: `var(--s-2) var(--s-3)`, fontWeight: 'var(--fw-semibold)',
                  borderTop: '2px solid var(--line-strong)',
                }}>Total</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{totals.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{formatCents(totals.valueCents)}</td>
                <td style={{ borderTop: '2px solid var(--line-strong)' }} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
