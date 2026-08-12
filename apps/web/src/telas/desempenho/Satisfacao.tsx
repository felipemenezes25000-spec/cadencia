// apps/web/src/telas/desempenho/Satisfacao.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from '../../ui/Skeleton';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

export interface SatisfacaoProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    summary: NpsSummary;
    evolution: NpsPoint[];
    byProfessional: NpsByProfessional[];
    freshness: DataFreshness;
  }>;
}

const MESES_CURTO: readonly string[] = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function npsColor(score: number): string {
  if (score >= 75) return 'var(--ok)';
  if (score >= 50) return 'var(--accent)';
  if (score >= 0) return 'var(--warn)';
  return 'var(--danger)';
}

function NpsEvolutionChart({ points }: { readonly points: readonly NpsPoint[] }) {
  if (points.length === 0) return null;

  const width = 400;
  const height = 120;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const minScore = Math.min(...points.map((pt) => pt.score), 0);
  const maxScore = Math.max(...points.map((pt) => pt.score), 100);
  const range = maxScore - minScore || 1;

  const pathPoints = points.map((pt, i) => {
    const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
    const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
    return `${x},${y}`;
  });

  const pathD = pathPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');

  return (
    <svg
      role="img"
      aria-label="NPS evolutivo"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[400px]"
      style={{ height: `${height}px` }}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((pt, i) => {
        const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
        const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
        const [, monthStr] = pt.period.split('-');
        const monthIdx = Number(monthStr) - 1;
        return (
          <g key={pt.period}>
            <circle cx={x} cy={y} r={3} fill="var(--accent)" />
            <text
              x={x}
              y={height - 4}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {MESES_CURTO[monthIdx]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const thClasses = cn(
  'border-b border-line px-3 py-2 text-[var(--fs-11)]',
  'font-medium uppercase tracking-[.04em] text-text-muted',
);

function SatisfacaoSkeleton() {
  return (
    <div
      className="cadencia-page grid gap-6 max-w-[960px]"
      role="status"
      aria-label="Carregando satisfação"
    >
      <Skeleton variant="text" width="140px" height="28px" />
      <Skeleton variant="text" width="140px" height="12px" />
      <Skeleton variant="card" height="160px" />
      <Skeleton variant="card" height="120px" />
      <div className="space-y-1">
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    </div>
  );
}

export function Satisfacao(p: SatisfacaoProps) {
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [evolution, setEvolution] = useState<NpsPoint[]>([]);
  const [byProf, setByProf] = useState<NpsByProfessional[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    void p.carregarDados().then((r) => {
      setSummary(r.summary);
      setEvolution(r.evolution);
      setFreshness(r.freshness);
      setLoading(false);
      timerId = setTimeout(() => setByProf(r.byProfessional), 0);
    });
    return () => { if (timerId !== undefined) clearTimeout(timerId); };
  }, [p]);

  if (loading && summary === null) {
    return <SatisfacaoSkeleton />;
  }

  return (
    <div className="cadencia-page grid gap-6 max-w-[960px]">
      <h1 className="m-0 text-[var(--fs-22)] font-semibold leading-tight">
        Satisfação
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p className="m-0 text-[var(--fs-11)] uppercase tracking-[.04em] text-text-faint">
          dados até {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* NPS em destaque */}
      {summary !== null ? (
        <section
          aria-label="NPS do período"
          className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-elev-1"
        >
          <div className="flex items-baseline gap-3">
            <span
              className="num text-[var(--fs-28)] font-semibold tabular-nums"
              style={{ color: npsColor(summary.score) }}
            >
              {summary.score}
            </span>
            <span className="text-[var(--fs-14)] text-text-muted">
              NPS — {summary.totalResponses} respostas
            </span>
          </div>

          <div className="flex gap-6">
            <div>
              <span className="num text-[var(--fs-18)] font-semibold text-ok">
                {summary.promoters}
              </span>
              <span className="block text-[var(--fs-11)] uppercase tracking-[.04em] text-text-muted">
                Promotores
              </span>
            </div>
            <div>
              <span className="num text-[var(--fs-18)] font-semibold text-text-muted">
                {summary.passives}
              </span>
              <span className="block text-[var(--fs-11)] uppercase tracking-[.04em] text-text-muted">
                Neutros
              </span>
            </div>
            <div>
              <span className="num text-[var(--fs-18)] font-semibold text-danger">
                {summary.detractors}
              </span>
              <span className="block text-[var(--fs-11)] uppercase tracking-[.04em] text-text-muted">
                Detratores
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Gráfico evolutivo */}
      {evolution.length > 0 ? (
        <section
          aria-label="Evolução do NPS"
          className="rounded-xl border border-line bg-surface p-4 shadow-elev-1"
        >
          <h2 className="m-0 mb-3 text-[var(--fs-15)] font-semibold">
            Evolutivo
          </h2>
          <div className="overflow-x-auto">
            <NpsEvolutionChart points={evolution} />
          </div>
        </section>
      ) : null}

      {/* Ranking por profissional */}
      {byProf.length > 0 ? (
        <section
          aria-label="NPS por profissional"
          className="rounded-xl border border-line bg-surface p-4 shadow-elev-1"
        >
          <h2 className="m-0 mb-3 text-[var(--fs-15)] font-semibold">
            Por profissional
          </h2>
          <table className="w-full border-collapse text-[var(--fs-13)]">
            <thead>
              <tr>
                <th className={cn(thClasses, 'text-left')}>Profissional</th>
                <th className={cn(thClasses, 'text-right')}>NPS</th>
                <th className={cn(thClasses, 'text-right')}>Respostas</th>
              </tr>
            </thead>
            <tbody>
              {byProf.map((prof) => (
                <tr key={prof.professionalId} className="transition-colors-fast hover:bg-surface-raised">
                  <td className="border-b border-line px-3 py-2">
                    {prof.professionalName}
                  </td>
                  <td
                    className="num border-b border-line px-3 py-2 text-right font-medium tabular-nums"
                    style={{ color: npsColor(prof.score) }}
                  >
                    {prof.score}
                  </td>
                  <td className="num border-b border-line px-3 py-2 text-right tabular-nums">
                    {prof.responses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
