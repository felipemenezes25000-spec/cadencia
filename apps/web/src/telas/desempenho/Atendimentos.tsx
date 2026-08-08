// apps/web/src/telas/desempenho/Atendimentos.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from '../../ui/Skeleton';
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

const thClasses = cn(
  'border-b border-line px-3 py-2 text-[var(--fs-11)]',
  'font-medium uppercase tracking-[.04em] text-text-muted',
);

function AtendimentosSkeleton() {
  return (
    <div
      className="grid gap-6 p-6 mx-auto max-w-[1080px]"
      role="status"
      aria-label="Carregando atendimentos"
    >
      <Skeleton variant="text" width="160px" height="28px" />
      <Skeleton variant="text" width="140px" height="12px" />
      <div className="space-y-1">
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    </div>
  );
}

export function Atendimentos(p: AtendimentosProps) {
  const [rows, setRows] = useState<AtendimentoRow[]>([]);
  const [totals, setTotals] = useState<AtendimentoTotals | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void p.carregarDados().then((r) => {
      setRows(r.rows);
      setTotals(r.totals);
      setFreshness(r.freshness);
      setLoading(false);
    });
  }, [p]);

  if (loading && rows.length === 0) {
    return <AtendimentosSkeleton />;
  }

  return (
    <div className="grid gap-6 p-6 mx-auto max-w-[1080px]">
      <h1 className="m-0 text-[var(--fs-22)] font-semibold leading-tight">
        Atendimentos
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p className="m-0 text-[var(--fs-11)] uppercase tracking-[.04em] text-text-faint">
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      <section aria-label="Tabela de atendimentos" className="overflow-x-auto">
        <table className="w-full border-collapse text-[var(--fs-13)]">
          <thead>
            <tr>
              <th className={cn(thClasses, 'text-left')}>Profissional</th>
              <th className={cn(thClasses, 'text-left')}>Procedimento</th>
              <th className={cn(thClasses, 'text-right')}>Qtd</th>
              <th className={cn(thClasses, 'text-right')}>Valor</th>
              <th className={cn(thClasses, 'text-right')}>Duracao media</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="transition-colors-fast hover:bg-surface-raised">
                <td className="border-b border-line px-3 py-2">
                  {r.professionalName}
                </td>
                <td className="border-b border-line px-3 py-2">
                  {r.procedureName}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right tabular-nums">
                  {r.count}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right tabular-nums">
                  {formatCents(r.valueCents)}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right tabular-nums">
                  {r.avgDurationMin} min
                </td>
              </tr>
            ))}
          </tbody>
          {totals !== null ? (
            <tfoot>
              <tr>
                <td
                  colSpan={2}
                  className="border-t-2 border-line-strong px-3 py-2 font-semibold"
                >
                  Total
                </td>
                <td className="num border-t-2 border-line-strong px-3 py-2 text-right font-semibold tabular-nums">
                  {totals.count}
                </td>
                <td className="num border-t-2 border-line-strong px-3 py-2 text-right font-semibold tabular-nums">
                  {formatCents(totals.valueCents)}
                </td>
                <td className="border-t-2 border-line-strong" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
