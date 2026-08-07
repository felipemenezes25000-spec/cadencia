// apps/web/src/telas/desempenho/Desempenho.tsx
'use client';

import { useEffect, useState } from 'react';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  Period,
  DataFreshness,
} from './types';
import { buildVariationPhrase, formatPeriodLabel } from './format';
import { WaterfallChart } from './WaterfallChart';

export interface DesempenhoProps {
  readonly period: Period;
  readonly aoMudarPeriodo: (period: Period) => void;
  readonly carregarIndicadores: () => Promise<{
    indicators: VariationIndicator[];
    freshness: DataFreshness;
  }>;
  readonly carregarWaterfall: (metric: string) => Promise<WaterfallFactor[]>;
  readonly carregarDrillDown: (metric: string, factorId: string) => Promise<{
    result: DrillDownResult;
    actions: SuggestedAction[];
  }>;
}

function formatFreshnessTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function Desempenho(p: DesempenhoProps) {
  const [indicators, setIndicators] = useState<VariationIndicator[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallFactor[]>([]);
  const [drillDown, setDrillDown] = useState<DrillDownResult | null>(null);
  const [actions, setActions] = useState<SuggestedAction[]>([]);

  useEffect(() => {
    void p.carregarIndicadores().then((r) => {
      setIndicators(r.indicators);
      setFreshness(r.freshness);
    });
  }, [p]);

  async function onIndicatorClick(metric: string): Promise<void> {
    setSelectedMetric(metric);
    setDrillDown(null);
    setActions([]);
    const factors = await p.carregarWaterfall(metric);
    setWaterfall(factors);
  }

  async function onFactorClick(factorId: string): Promise<void> {
    if (selectedMetric === null) return;
    const { result, actions: suggestedActions } =
      await p.carregarDrillDown(selectedMetric, factorId);
    setDrillDown(result);
    setActions(suggestedActions);
  }

  const periodLabel = formatPeriodLabel(p.period.current, p.period.previous);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Desempenho
        </h1>
        <p style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)', margin: `var(--s-2) 0 0` }}>
          {periodLabel}
        </p>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {formatFreshnessTime(freshness.refreshedAt)}
        </p>
      ) : null}

      {/* Frases de variacao */}
      <section aria-label="Variacoes do periodo"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)',
                 display: 'grid', gap: 'var(--s-4)' }}>
        {indicators.map((ind) => {
          const phrase = buildVariationPhrase(ind.metric, ind.deltaAbsolute, ind.deltaPercent);
          const isSelected = selectedMetric === ind.metric;
          return (
            <button key={ind.metric} type="button"
              aria-label={phrase}
              aria-expanded={isSelected}
              onClick={() => { void onIndicatorClick(ind.metric); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isSelected ? 'var(--surface-hover)' : 'transparent',
                border: 0, cursor: 'pointer', padding: `var(--s-4) var(--s-4)`,
                borderRadius: 'var(--r-sm)', textAlign: 'left',
                fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                color: 'var(--text)', width: '100%',
              }}>
              <span>{phrase}</span>
              <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>&#8250;</span>
            </button>
          );
        })}
      </section>

      {/* Waterfall de decomposicao */}
      {selectedMetric !== null && waterfall.length > 0 ? (
        <section aria-label="Decomposicao"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   overflowX: 'auto' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-6)` }}>
            Decomposicao
          </h2>
          <WaterfallChart factors={waterfall} onFactorClick={onFactorClick} />
        </section>
      ) : null}

      {/* Drill-down */}
      {drillDown !== null ? (
        <section aria-label="Detalhamento"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-2)` }}>
            Detalhamento
          </h2>
          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
                      margin: `0 0 var(--s-5)` }}>
            {drillDown.totalCount} atendimentos
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Grupo
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Qtd
                </th>
              </tr>
            </thead>
            <tbody>
              {drillDown.groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`,
                               borderBottom: 'var(--border)' }}>
                    {g.label}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {g.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Acoes sugeridas */}
          {actions.length > 0 ? (
            <div style={{ marginTop: 'var(--s-6)', display: 'grid', gap: 'var(--s-3)' }}>
              {actions.map((a) => (
                <a key={a.actionId} href={a.href}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)',
                    fontSize: 'var(--fs-14)', color: 'var(--accent)',
                    fontWeight: 'var(--fw-medium)', textDecoration: 'none',
                  }}>
                  {a.label}
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

    </div>
  );
}
