'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ChartLineUp, Clock, Sparkle, TrendUp } from '@phosphor-icons/react';
import type { VariationIndicator, WaterfallFactor, DrillDownResult, SuggestedAction, Period, DataFreshness } from './types';
import { buildVariationPhrase, formatPeriodLabel } from './format';
import { WaterfallChart } from './WaterfallChart';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../lib/cn';

export interface DesempenhoProps {
  readonly period: Period;
  readonly aoMudarPeriodo: (period: Period) => void;
  readonly carregarIndicadores: () => Promise<{ indicators: VariationIndicator[]; freshness: DataFreshness }>;
  readonly carregarWaterfall: (metric: string) => Promise<WaterfallFactor[]>;
  readonly carregarDrillDown: (metric: string, factorId: string) => Promise<{ result: DrillDownResult; actions: SuggestedAction[] }>;
}

function formatFreshnessTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function DesempenhoVariacoesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando indicadores" data-testid="desempenho-variacoes-skeleton" className="cadencia-page grid gap-6">
      <div className="space-y-2"><Skeleton variant="text" width="170px" height="30px" /><Skeleton variant="text" width="230px" /></div>
      <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="card" height="150px" />)}</div>
    </div>
  );
}

function MetricSignal({ ind, selected, onClick }: { readonly ind: VariationIndicator; readonly selected: boolean; readonly onClick: () => void }) {
  const phrase = buildVariationPhrase(ind.metric, ind.deltaAbsolute, ind.deltaPercent);
  const positivo = ind.deltaAbsolute >= 0;
  return (
    <button
      type="button" aria-label={phrase} aria-expanded={selected} onClick={onClick}
      className={cn(
        'cadencia-metric group min-h-[144px] p-4 text-left sm:p-5',
        selected && 'border-accent/30 bg-accent-soft ring-1 ring-accent/10',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', positivo ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}><TrendUp size={18} weight="duotone" className={cn(!positivo && 'rotate-180')} /></span>
        <span className={cn('rounded-full px-2 py-1 text-[9px] font-bold tabular-nums', positivo ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>{ind.deltaPercent > 0 ? '+' : ''}{ind.deltaPercent}%</span>
      </div>
      <p className="m-0 mt-4 text-sm font-semibold leading-snug tracking-[-.02em] text-text">{phrase}</p>
      <span className="mt-3 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[.08em] text-text-faint transition-colors group-hover:text-accent">Explicar variação <ArrowRight size={11} /></span>
    </button>
  );
}

export function Desempenho(p: DesempenhoProps) {
  const [indicators, setIndicators] = useState<VariationIndicator[] | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallFactor[]>([]);
  const [drillDown, setDrillDown] = useState<DrillDownResult | null>(null);
  const [actions, setActions] = useState<SuggestedAction[]>([]);

  useEffect(() => {
    let ativo = true;
    void p.carregarIndicadores().then((r) => { if (ativo) { setIndicators(r.indicators); setFreshness(r.freshness); } });
    return () => { ativo = false; };
  }, [p.carregarIndicadores]);

  if (indicators === null) return <DesempenhoVariacoesSkeleton />;

  async function onIndicatorClick(metric: string): Promise<void> {
    setSelectedMetric(metric); setDrillDown(null); setActions([]); setWaterfall([]);
    setWaterfall(await p.carregarWaterfall(metric));
  }

  async function onFactorClick(factorId: string): Promise<void> {
    if (selectedMetric === null) return;
    const r = await p.carregarDrillDown(selectedMetric, factorId);
    setDrillDown(r.result); setActions(r.actions);
  }

  const periodLabel = formatPeriodLabel(p.period.current, p.period.previous);

  return (
    <div className="cadencia-page grid gap-6">
      <header className="cadencia-panel cadencia-panel-hero p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="cadencia-eyebrow"><Sparkle size={11} weight="fill" /> Diagnóstico do período</div><h1 className="m-0 mt-2 text-[clamp(1.8rem,3vw,2.5rem)] font-semibold tracking-[-.05em] text-text">Desempenho</h1><p className="m-0 mt-2 text-sm text-text-muted">{periodLabel}</p></div>
          {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? <p className="m-0 flex items-center gap-1.5 rounded-full border border-line bg-surface/72 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-text-faint"><Clock size={12} /> dados ate {formatFreshnessTime(freshness.refreshedAt)}</p> : null}
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3" role="group" aria-label="Variacoes do periodo">
          {indicators.map((ind) => <MetricSignal key={ind.metric} ind={ind} selected={selectedMetric === ind.metric} onClick={() => { void onIndicatorClick(ind.metric); }} />)}
        </div>
      </header>

      {selectedMetric !== null && waterfall.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
          <section aria-label="Decomposicao" className="cadencia-panel overflow-x-auto p-5 scrollbar-thin">
            <div className="mb-5"><span className="cadencia-eyebrow">Causalidade</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Decomposicao</h2><p className="m-0 mt-1 text-xs text-text-muted">Clique em um fator para abrir o recorte que explica o movimento.</p></div>
            <WaterfallChart factors={waterfall} onFactorClick={onFactorClick} />
          </section>

          <section aria-label="Detalhamento" className="cadencia-panel min-h-[260px] overflow-hidden">
            <div className="border-b border-line/70 p-5"><span className="cadencia-eyebrow">Drill-down</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Detalhamento</h2></div>
            {drillDown === null ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center px-5 text-center"><span className="cadencia-icon-orb mb-3 h-11 w-11"><ChartLineUp size={20} weight="duotone" /></span><p className="m-0 max-w-xs text-xs leading-relaxed text-text-muted">Selecione um fator no gráfico para descobrir os grupos por trás da variação.</p></div>
            ) : (
              <div className="p-5">
                <p className="m-0 mb-4 text-xs font-medium text-text-muted">{drillDown.totalCount} atendimentos</p>
                <div className="overflow-hidden rounded-xl border border-line/70">
                  <table className="w-full text-xs"><thead><tr><th className="bg-surface-sunken/55 px-3 py-2.5 text-left">Grupo</th><th className="bg-surface-sunken/55 px-3 py-2.5 text-right">Qtd</th></tr></thead><tbody>{drillDown.groups.map((g) => <tr key={g.key}><td className="border-t border-line/65 px-3 py-2.5 font-medium text-text">{g.label}</td><td className="border-t border-line/65 px-3 py-2.5 text-right font-semibold tabular-nums">{g.count}</td></tr>)}</tbody></table>
                </div>
                {actions.length > 0 && <div className="mt-5 grid gap-2">{actions.map((a) => <a key={a.actionId} href={a.href} className="group flex items-center justify-between gap-3 rounded-xl border border-accent/15 bg-accent-soft px-3 py-3 text-xs font-semibold text-accent no-underline transition-all hover:-translate-y-px hover:shadow-elev-1">{a.label}<ArrowRight size={14} className="shrink-0 transition-transform group-hover:translate-x-0.5" /></a>)}</div>}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
