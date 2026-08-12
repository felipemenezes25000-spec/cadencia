// apps/web/src/telas/desempenho/Desempenho.tsx
'use client';

import { useEffect, useState } from 'react';
import { CaretRight, ChartBar, Clock } from '@phosphor-icons/react';
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
import { Skeleton } from '../../ui/Skeleton';
import { PageHeader } from '../../ui/PageHeader';
import { cn } from '../../lib/cn';

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

function mesAnterior(mes: string): string {
  const [ano, valorMes] = mes.split('-').map(Number) as [number, number];
  return valorMes === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(valorMes - 1).padStart(2, '0')}`;
}

function DesempenhoVariacoesSkeleton() {
  return (
    <div className="cadencia-page grid gap-6" role="status" aria-busy="true" aria-label="Carregando indicadores" data-testid="desempenho-variacoes-skeleton">
      <div className="space-y-2"><Skeleton variant="text" width="180px" height="28px" /><Skeleton variant="text" width="320px" /></div>
      <Skeleton variant="card" height="230px" />
      <Skeleton variant="card" height="320px" />
    </div>
  );
}

export function Desempenho(p: DesempenhoProps) {
  const [indicators, setIndicators] = useState<VariationIndicator[] | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallFactor[]>([]);
  const [drillDown, setDrillDown] = useState<DrillDownResult | null>(null);
  const [actions, setActions] = useState<SuggestedAction[]>([]);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  useEffect(() => {
    let ativo = true;
    setIndicators(null);
    void p.carregarIndicadores().then((r) => {
      if (!ativo) return;
      setIndicators(r.indicators);
      setFreshness(r.freshness);
      setSelectedMetric(null);
      setWaterfall([]);
      setDrillDown(null);
      setActions([]);
    });
    return () => { ativo = false; };
  }, [p.period.current, p.carregarIndicadores]);

  if (indicators === null) return <DesempenhoVariacoesSkeleton />;

  async function onIndicatorClick(metric: string): Promise<void> {
    setSelectedMetric(metric);
    setDrillDown(null);
    setActions([]);
    setCarregandoDetalhe(true);
    try {
      setWaterfall(await p.carregarWaterfall(metric));
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  async function onFactorClick(factorId: string): Promise<void> {
    if (selectedMetric === null) return;
    setCarregandoDetalhe(true);
    try {
      const { result, actions: suggestedActions } = await p.carregarDrillDown(selectedMetric, factorId);
      setDrillDown(result);
      setActions(suggestedActions);
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  const periodLabel = formatPeriodLabel(p.period.current, p.period.previous);
  const destaque = indicators.reduce<VariationIndicator | null>((atual, indicador) => {
    if (atual === null) return indicador;
    return Math.abs(indicador.deltaPercent) > Math.abs(atual.deltaPercent) ? indicador : atual;
  }, null);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Desempenho"
        eyebrow="Inteligência da clínica"
        subtitulo={periodLabel}
        semBreadcrumb
        acoes={(
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            <span className="sr-only">Mês analisado</span>
            <input
              type="month"
              value={p.period.current}
              onChange={(e) => {
                if (!e.target.value) return;
                p.aoMudarPeriodo({ current: e.target.value, previous: mesAnterior(e.target.value) });
              }}
              className="h-9 rounded-[10px] border border-line bg-surface px-3 text-sm font-semibold text-text shadow-elev-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
              aria-label="Mês analisado"
            />
          </label>
        )}
      />

      <section className="cadencia-surface overflow-hidden" aria-label="Resumo executivo">
        <div className="grid gap-5 border-b border-line p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="cadencia-eyebrow">Leitura principal</p>
            <h2 className="mt-2 max-w-4xl text-[22px] font-bold leading-tight tracking-[-0.035em] text-text sm:text-[26px]">
              {destaque ? buildVariationPhrase(destaque.metric, destaque.deltaAbsolute, destaque.deltaPercent) : 'Sem variação relevante no período'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
              Selecione um indicador para decompor a variação, entender os fatores e chegar à ação operacional correspondente.
            </p>
          </div>
          {freshness !== null ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-subtle px-3 py-1.5 text-[11px] font-semibold text-text-faint">
              <Clock size={14} aria-hidden />
              {freshness.source === 'matview' && freshness.refreshedAt !== null
                ? `Dados até ${formatFreshnessTime(freshness.refreshedAt)}`
                : 'Dados em tempo real'}
            </span>
          ) : null}
        </div>

        <div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {indicators.map((ind) => {
            const phrase = buildVariationPhrase(ind.metric, ind.deltaAbsolute, ind.deltaPercent);
            const isSelected = selectedMetric === ind.metric;
            const positiva = ind.deltaPercent >= 0;
            return (
              <button
                key={ind.metric}
                type="button"
                aria-label={phrase}
                aria-expanded={isSelected}
                onClick={() => { void onIndicatorClick(ind.metric); }}
                className={cn(
                  'group min-h-[122px] p-5 text-left transition-colors-fast sm:p-6',
                  isSelected ? 'bg-accent-soft/55' : 'hover:bg-surface-subtle',
                )}
              >
                <span className="flex items-start justify-between gap-4">
                  <span className="grid size-9 place-items-center rounded-xl bg-surface text-accent shadow-elev-1"><ChartBar size={18} aria-hidden /></span>
                  <span className={cn('rounded-full px-2 py-1 text-[11px] font-bold tabular-nums', positiva ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
                    {ind.deltaPercent > 0 ? '+' : ''}{ind.deltaPercent.toFixed(1)}%
                  </span>
                </span>
                <span className="mt-4 block text-sm font-semibold leading-relaxed text-text">{phrase}</span>
                <span className={cn('mt-2 inline-flex items-center gap-1 text-xs font-semibold', isSelected ? 'text-accent' : 'text-text-faint group-hover:text-accent')}>
                  Entender variação <CaretRight size={13} aria-hidden />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {carregandoDetalhe && waterfall.length === 0 ? <Skeleton variant="card" height="320px" /> : null}

      {selectedMetric !== null && waterfall.length > 0 ? (
        <section aria-label="Decomposição" className="cadencia-surface overflow-hidden">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <p className="cadencia-eyebrow">Por que mudou</p>
            <h2 className="mt-1 text-lg font-bold tracking-[-0.025em] text-text">Decomposição da variação</h2>
            <p className="mt-1 text-xs text-text-muted">Clique em um fator para abrir os grupos que explicam o resultado.</p>
          </div>
          <div className="overflow-x-auto p-4 sm:p-6">
            <WaterfallChart factors={waterfall} onFactorClick={onFactorClick} />
          </div>
        </section>
      ) : null}

      {drillDown !== null ? (
        <section aria-label="Detalhamento" className="cadencia-surface overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <p className="cadencia-eyebrow">Evidência</p>
              <h2 className="mt-1 text-lg font-bold tracking-[-0.025em] text-text">Detalhamento</h2>
            </div>
            <span className="rounded-full bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-muted">{drillDown.totalCount} atendimentos</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="bg-surface-subtle">
                  <th className="border-b border-line px-5 py-2.5 text-left sm:px-6">Grupo</th>
                  <th className="border-b border-line px-5 py-2.5 text-right sm:px-6">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {drillDown.groups.map((g) => (
                  <tr key={g.key} className="hover:bg-surface-hover">
                    <td className="border-b border-line px-5 py-3 font-medium text-text sm:px-6">{g.label}</td>
                    <td className="num border-b border-line px-5 py-3 text-right font-semibold text-text-muted sm:px-6">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {actions.length > 0 ? (
            <div className="border-t border-line bg-accent-soft/35 p-5 sm:p-6">
              <p className="cadencia-eyebrow">O que fazer agora</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {actions.map((a) => (
                  <a key={a.actionId} href={a.href} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-accent bg-accent px-3.5 text-sm font-semibold text-white shadow-elev-1 hover:bg-accent-hover">
                    {a.label}<CaretRight size={14} aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
