'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, CurrencyDollar, Stethoscope, TrendUp } from '@phosphor-icons/react';
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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

const thClasses = cn(
  'border-b border-line/70 px-4 py-3 text-[10px]',
  'font-bold uppercase tracking-[.09em] text-text-faint',
);

function AtendimentosSkeleton() {
  return (
    <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1280px] gap-6" role="status" aria-label="Carregando atendimentos">
      <div className="space-y-2"><Skeleton variant="text" width="180px" height="34px" /><Skeleton variant="text" width="300px" height="14px" /></div>
      <div className="grid gap-3 sm:grid-cols-3"><Skeleton variant="card" height="112px" /><Skeleton variant="card" height="112px" /><Skeleton variant="card" height="112px" /></div>
      <Skeleton variant="card" height="320px" />
    </div>
  );
}

export function Atendimentos(p: AtendimentosProps) {
  const [rows, setRows] = useState<AtendimentoRow[]>([]);
  const [totals, setTotals] = useState<AtendimentoTotals | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void p.carregarDados().then((r) => {
      if (!active) return;
      setRows(r.rows);
      setTotals(r.totals);
      setFreshness(r.freshness);
      setLoading(false);
    });
    return () => { active = false; };
  }, [p.carregarDados]);

  const maxCount = useMemo(() => Math.max(...rows.map((row) => row.count), 1), [rows]);
  const avgDuration = useMemo(() => {
    const weighted = rows.reduce((acc, row) => acc + row.avgDurationMin * row.count, 0);
    const count = rows.reduce((acc, row) => acc + row.count, 0);
    return count > 0 ? Math.round(weighted / count) : 0;
  }, [rows]);
  const avgTicket = totals && totals.count > 0 ? Math.round(totals.valueCents / totals.count) : 0;

  if (loading && rows.length === 0) return <AtendimentosSkeleton />;

  return (
    <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1280px] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="cadencia-eyebrow">Inteligência operacional</span>
          <h1 className="m-0 mt-2 text-[clamp(1.8rem,3.2vw,2.7rem)] font-semibold leading-none tracking-[-.05em] text-text">Atendimentos</h1>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Volume, receita e tempo clínico em uma leitura única — para enxergar capacidade antes de virar gargalo.</p>
        </div>
        {freshness?.source === 'matview' && freshness.refreshedAt !== null ? (
          <div className="rounded-full border border-line/70 bg-surface/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-text-faint shadow-elev-1">
            dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
          </div>
        ) : null}
      </header>

      <section aria-label="Resumo dos atendimentos" className="grid gap-3 sm:grid-cols-3">
        <div className="cadencia-metric p-5"><div className="cadencia-icon-orb"><Stethoscope size={18} weight="duotone" /></div><span className="mt-4 block text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Atendimentos</span><strong className="num mt-1 block text-[30px] tracking-[-.06em] text-text"><span className="sr-only">{`${totals?.count ?? 0} atendimentos`}</span><span aria-hidden>{String(totals?.count ?? 0).slice(0, -1) || '0'}</span><span aria-hidden>{String(totals?.count ?? 0).slice(-1)}</span></strong><p className="m-0 mt-1 text-xs text-text-muted">volume consolidado no período</p></div>
        <div className="cadencia-metric p-5"><div className="cadencia-icon-orb"><CurrencyDollar size={18} weight="duotone" /></div><span className="mt-4 block text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Receita capturada</span><strong className="num mt-1 block text-[clamp(1.35rem,2vw,1.8rem)] tracking-[-.05em] text-accent">{formatCents(totals?.valueCents ?? 0)}</strong><p className="m-0 mt-1 text-xs text-text-muted">ticket médio {formatCents(avgTicket)}</p></div>
        <div className="cadencia-metric p-5"><div className="cadencia-icon-orb"><Clock size={18} weight="duotone" /></div><span className="mt-4 block text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Tempo médio</span><strong className="num mt-1 block text-[30px] tracking-[-.06em] text-text">{avgDuration}<span className="ml-1 text-base font-medium text-text-muted">min</span></strong><p className="m-0 mt-1 text-xs text-text-muted">média ponderada por volume</p></div>
      </section>

      <section aria-label="Tabela de atendimentos" className="cadencia-data-grid overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4 sm:px-6">
          <div><span className="cadencia-eyebrow">Mapa de produção</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Onde o volume acontece</h2></div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ok"><TrendUp size={14} weight="bold" /> leitura por profissional e procedimento</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead><tr><th className={cn(thClasses, 'text-left')}>Profissional</th><th className={cn(thClasses, 'text-left')}>Procedimento</th><th className={cn(thClasses, 'text-right')}>Qtd</th><th className={cn(thClasses, 'text-right')}>Valor</th><th className={cn(thClasses, 'text-right')}>Duracao media</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="group transition-colors-fast hover:bg-accent-soft/35">
                  <td className="border-b border-line/70 px-4 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-surface-sunken text-[10px] font-bold text-text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">{initials(r.professionalName)}</span><span className="font-semibold text-text">{r.professionalName}</span></div></td>
                  <td className="border-b border-line/70 px-4 py-3.5 text-text-muted">{r.procedureName}</td>
                  <td className="num border-b border-line/70 px-4 py-3.5 text-right font-semibold tabular-nums"><div className="ml-auto flex max-w-[110px] items-center justify-end gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(8, (r.count / maxCount) * 100)}%` }} /></span><span>{r.count}</span></div></td>
                  <td className="num border-b border-line/70 px-4 py-3.5 text-right font-semibold tabular-nums">{formatCents(r.valueCents)}</td>
                  <td className="num border-b border-line/70 px-4 py-3.5 text-right tabular-nums text-text-muted">{r.avgDurationMin} min</td>
                </tr>
              ))}
            </tbody>
            {totals ? <tfoot><tr className="bg-surface-sunken/55"><td colSpan={2} className="border-t border-line-strong px-4 py-3.5 font-semibold">Total</td><td className="num border-t border-line-strong px-4 py-3.5 text-right font-semibold tabular-nums">{totals.count}</td><td className="num border-t border-line-strong px-4 py-3.5 text-right font-semibold tabular-nums">{formatCents(totals.valueCents)}</td><td className="border-t border-line-strong" /></tr></tfoot> : null}
          </table>
        </div>
      </section>
    </div>
  );
}
