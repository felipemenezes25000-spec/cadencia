// apps/web/src/telas/desempenho/Satisfacao.tsx
'use client';

import { useEffect, useState } from 'react';
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
  const minScore = Math.min(...points.map((p) => p.score), 0);
  const maxScore = Math.max(...points.map((p) => p.score), 100);
  const range = maxScore - minScore || 1;

  const pathPoints = points.map((pt, i) => {
    const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
    const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
    return `${x},${y}`;
  });

  const pathD = pathPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');

  return (
    <svg
      role="img" aria-label="NPS evolutivo"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: `${width}px`, height: `${height}px` }}
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
            <text x={x} y={height - 4} textAnchor="middle"
              fontSize="10" fill="var(--text-muted)">
              {MESES_CURTO[monthIdx]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Satisfacao(p: SatisfacaoProps) {
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [evolution, setEvolution] = useState<NpsPoint[]>([]);
  const [byProf, setByProf] = useState<NpsByProfessional[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    void p.carregarDados().then((r) => {
      setSummary(r.summary);
      setEvolution(r.evolution);
      setFreshness(r.freshness);
      timerId = setTimeout(() => setByProf(r.byProfessional), 0);
    });
    return () => { if (timerId !== undefined) clearTimeout(timerId); };
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Satisfacao
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* NPS em destaque */}
      {summary !== null ? (
        <section aria-label="NPS do periodo"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-5)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)' }}>
            <span className="num" style={{
              fontSize: 'var(--fs-28)', fontWeight: 'var(--fw-semibold)',
              color: npsColor(summary.score),
              fontVariantNumeric: 'tabular-nums',
            }}>
              {summary.score}
            </span>
            <span style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)' }}>
              NPS — {summary.totalResponses} respostas
            </span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--s-8)' }}>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--ok)' }}>
                {summary.promoters}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Promotores
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--text-muted)' }}>
                {summary.passives}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Neutros
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--danger)' }}>
                {summary.detractors}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Detratores
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Grafico evolutivo */}
      {evolution.length > 0 ? (
        <section aria-label="Evolucao do NPS"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Evolutivo
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <NpsEvolutionChart points={evolution} />
          </div>
        </section>
      ) : null}

      {/* Ranking por profissional */}
      {byProf.length > 0 ? (
        <section aria-label="NPS por profissional"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Por profissional
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Profissional
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  NPS
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Respostas
                </th>
              </tr>
            </thead>
            <tbody>
              {byProf.map((prof) => (
                <tr key={prof.professionalId}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                    {prof.professionalName}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                    color: npsColor(prof.score), fontWeight: 'var(--fw-medium)',
                  }}>
                    {prof.score}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
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
