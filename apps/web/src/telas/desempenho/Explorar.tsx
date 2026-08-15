// apps/web/src/telas/desempenho/Explorar.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { Botao } from '../../ui/Botao';
import { Skeleton } from '../../ui/Skeleton';
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
    <div role="img" aria-label="Gráfico de barras">
      {rows.map((r) => {
        const width = Math.max((r.valueCents / maxVal) * 100, 2);
        return (
          <div key={r.key} className="mb-1">
            <div className="h-5 overflow-hidden rounded-sm bg-surface-sunken">
              <div
                className="h-full rounded-sm bg-accent transition-all duration-300 ease-out"
                style={{ width: `${width}%` }}
                title={`${r.label}: ${formatCents(r.valueCents)}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExplorarSkeleton() {
  return (
    <div
      className="cadencia-page grid gap-6 max-w-[1080px]"
      role="status"
      aria-label="Carregando explorador"
    >
      <div className="flex items-center justify-between">
        <Skeleton variant="text" width="120px" height="28px" />
        <Skeleton variant="text" width="100px" height="28px" />
      </div>
      <Skeleton variant="text" width="160px" height="12px" />
      <div className="flex gap-1">
        <Skeleton variant="text" width="140px" height="32px" />
        <Skeleton variant="text" width="140px" height="32px" />
      </div>
      <Skeleton variant="card" height="200px" />
      <div className="space-y-1">
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    </div>
  );
}

export function Explorar(p: ExplorarProps) {
  const [rows, setRows] = useState<ExploreRow[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void p.carregarDados(p.filters).then((r) => {
      setRows(r.rows);
      setFreshness(r.freshness);
      setLoading(false);
    });
  }, [p, p.filters]);

  if (loading && rows.length === 0) {
    return <ExplorarSkeleton />;
  }

  return (
    <div className="cadencia-page grid gap-6 max-w-[1080px]">
      <div className="flex items-center justify-between">
        <h1 className="m-0 text-[var(--fs-22)] font-semibold leading-tight">
          Explorar
        </h1>
        <Botao
          variante="secundario"
          altura={28}
          onClick={() => p.aoSalvarVisao('Nova visão', p.filters, p.chartKind)}
        >
          Salvar visão
        </Botao>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p className="m-0 text-[var(--fs-11)] uppercase tracking-[.04em] text-text-faint">
          dados até {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Tabs de visões salvas */}
      <div
        role="tablist"
        aria-label="Visões salvas"
        className="flex gap-0.5 overflow-x-auto border-b border-line scrollbar-thin"
      >
        {p.savedViews.map((v) => (
          <button
            key={v.viewId}
            role="tab"
            type="button"
            aria-selected={false}
            onClick={() => p.aoSelecionarVisao(v.viewId)}
            className={cn(
              'cursor-pointer border-0 border-b-2 border-transparent bg-transparent',
              'whitespace-nowrap px-3 py-2',
              'text-[var(--fs-13)] font-medium text-text-muted',
              'transition-colors-fast hover:text-text',
            )}
          >
            {v.name}
          </button>
        ))}
      </div>

      {/* Seletor de tipo de gráfico */}
      <div role="radiogroup" aria-label="Tipo de gráfico" className="flex gap-1">
        {(['bar', 'line', 'pie'] as const).map((kind) => (
          <button
            key={kind}
            role="radio"
            type="button"
            aria-checked={p.chartKind === kind}
            aria-label={CHART_LABELS[kind]}
            onClick={() => p.aoMudarGrafico(kind)}
            className={cn(
              'cursor-pointer rounded-lg px-2.5 py-1.5 transition-all-fast',
              'text-xs text-text transition-colors-fast',
              p.chartKind === kind
                ? 'border border-accent bg-accent-soft font-medium'
                : 'border border-line bg-surface font-normal shadow-elev-1 hover:border-line-strong hover:bg-surface-raised',
            )}
          >
            {CHART_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Gráfico */}
      <section
        aria-label="Resultado"
        className="rounded-xl border border-line bg-surface p-4 shadow-elev-1"
      >
        <SimpleBarChart rows={rows} />
      </section>

      {/* Tabela de dados */}
      <section aria-label="Tabela de dados" className="overflow-x-auto">
        <table className="w-full border-collapse text-[var(--fs-13)]">
          <thead>
            <tr>
              <th className="border-b border-line px-2 py-1.5 text-left text-[var(--fs-11)] font-medium uppercase tracking-[.04em] text-text-muted">
                Item
              </th>
              <th className="border-b border-line px-2 py-1.5 text-right text-[var(--fs-11)] font-medium uppercase tracking-[.04em] text-text-muted">
                Qtd
              </th>
              <th className="border-b border-line px-2 py-1.5 text-right text-[var(--fs-11)] font-medium uppercase tracking-[.04em] text-text-muted">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="transition-colors-fast hover:bg-surface-raised">
                <td className="border-b border-line px-2 py-1.5">
                  {r.label}
                </td>
                <td className="num border-b border-line px-2 py-1.5 text-right tabular-nums">
                  {r.count}
                </td>
                <td className="num border-b border-line px-2 py-1.5 text-right tabular-nums">
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
