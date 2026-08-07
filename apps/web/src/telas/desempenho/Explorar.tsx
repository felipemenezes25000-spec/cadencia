// apps/web/src/telas/desempenho/Explorar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../../ui/Botao';
import type {
  ExploreFilter,
  ExploreRow,
  SavedView,
  ChartKind,
  DataFreshness,
} from './types';

export interface ExplorarProps {
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
  readonly savedViews: readonly SavedView[];
  readonly aoMudarFiltros: (filters: ExploreFilter) => void;
  readonly aoMudarGrafico: (kind: ChartKind) => void;
  readonly carregarDados: (filters: ExploreFilter) => Promise<{
    rows: ExploreRow[];
    freshness: DataFreshness;
  }>;
  readonly aoSalvarVisao: (name: string, filters: ExploreFilter, chartKind: ChartKind) =>
    Promise<SavedView>;
  readonly aoSelecionarVisao: (viewId: string) => void;
}

const CHART_LABELS: Record<ChartKind, string> = {
  bar: 'Barras', line: 'Linhas', pie: 'Pizza',
};

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

function SimpleBarChart({ rows }: { readonly rows: readonly ExploreRow[] }) {
  const maxVal = Math.max(...rows.map((r) => r.valueCents), 1);
  return (
    <div role="img" aria-label="Grafico de barras">
      {rows.map((r) => {
        const width = Math.max((r.valueCents / maxVal) * 100, 2);
        return (
          <div key={r.key} style={{ marginBottom: 'var(--s-2)' }}>
            <div style={{ height: 20, background: 'var(--surface-sunken)',
                          borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%',
                            background: 'var(--accent)', borderRadius: 'var(--r-sm)' }}
                   title={`${r.label}: ${formatCents(r.valueCents)}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Explorar(p: ExplorarProps) {
  const [rows, setRows] = useState<ExploreRow[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados(p.filters).then((r) => {
      setRows(r.rows);
      setFreshness(r.freshness);
    });
  }, [p, p.filters]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Explorar
        </h1>
        <Botao variante="secundario" altura={28}
          onClick={() => { void p.aoSalvarVisao('Nova visao', p.filters, p.chartKind); }}>
          Salvar visao
        </Botao>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Tabs de visoes salvas */}
      <div role="tablist" aria-label="Visoes salvas"
        style={{ display: 'flex', gap: 'var(--s-1)', overflowX: 'auto',
                 borderBottom: 'var(--border)', paddingBottom: 0 }}>
        {p.savedViews.map((v) => (
          <button key={v.viewId} role="tab" type="button"
            aria-selected={false}
            onClick={() => p.aoSelecionarVisao(v.viewId)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              padding: `var(--s-3) var(--s-5)`,
              fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
              fontWeight: 'var(--fw-medium)',
              borderBottom: '2px solid transparent',
              whiteSpace: 'nowrap',
            }}>
            {v.name}
          </button>
        ))}
      </div>

      {/* Seletor de tipo de grafico */}
      <div role="radiogroup" aria-label="Tipo de grafico"
        style={{ display: 'flex', gap: 'var(--s-2)' }}>
        {(['bar', 'line', 'pie'] as const).map((kind) => (
          <button key={kind} role="radio" type="button"
            aria-checked={p.chartKind === kind}
            aria-label={CHART_LABELS[kind]}
            onClick={() => p.aoMudarGrafico(kind)}
            style={{
              border: p.chartKind === kind ? '1px solid var(--accent)' : 'var(--border)',
              background: p.chartKind === kind ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 'var(--r-md)', padding: `var(--s-2) var(--s-4)`,
              fontSize: 'var(--fs-12)', color: 'var(--text)', cursor: 'pointer',
              fontWeight: p.chartKind === kind ? 'var(--fw-medium)' : 'var(--fw-regular)',
            }}>
            {CHART_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Grafico */}
      <section aria-label="Resultado"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)' }}>
        <SimpleBarChart rows={rows} />
      </section>

      {/* Tabela de dados */}
      <section aria-label="Tabela de dados"
        style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Item
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Qtd
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)' }}>
                  {r.label}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.count}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatCents(r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
