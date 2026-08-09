'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChartBar, ChartLine, ChartPieSlice, FloppyDisk, Sparkle } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Botao } from '../../ui/Botao';
import { Skeleton } from '../../ui/Skeleton';
import type { ExploreFilter, ExploreRow, SavedView, ChartKind, DataFreshness } from './types';

export interface ExplorarProps {
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
  readonly savedViews: readonly SavedView[];
  readonly aoMudarFiltros: (filters: ExploreFilter) => void;
  readonly aoMudarGrafico: (kind: ChartKind) => void;
  readonly carregarDados: (filters: ExploreFilter) => Promise<{ rows: ExploreRow[]; freshness: DataFreshness }>;
  readonly aoSalvarVisao: (name: string, filters: ExploreFilter, chartKind: ChartKind) => Promise<SavedView>;
  readonly aoSelecionarVisao: (viewId: string) => void;
}

const CHART_LABELS: Record<ChartKind, string> = { bar: 'Barras', line: 'Linhas', pie: 'Pizza' };
const CHART_ICONS = { bar: ChartBar, line: ChartLine, pie: ChartPieSlice } as const;

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100), rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

function ExplorerVisual({ rows, kind }: { readonly rows: readonly ExploreRow[]; readonly kind: ChartKind }) {
  const maxVal = Math.max(...rows.map((r) => r.valueCents), 1);
  const total = rows.reduce((acc, row) => acc + row.valueCents, 0) || 1;
  if (kind === 'pie') {
    let current = 0;
    const stops = rows.map((row, i) => { const from = current; current += (row.valueCents / total) * 100; return `var(--chart-${(i % 4) + 1}, var(--accent)) ${from}% ${current}%`; }).join(', ');
    return <div role="img" aria-label="Grafico de barras" className="grid min-h-[250px] place-items-center"><div className="relative h-44 w-44 rounded-full shadow-[inset_0_0_0_1px_var(--line)]" style={{ background: `conic-gradient(${stops})` }}><div className="absolute inset-[28px] grid place-items-center rounded-full bg-surface shadow-elev-1"><div className="text-center"><span className="cadencia-eyebrow">Total</span><strong className="num mt-1 block text-lg tracking-[-.04em]">{formatCents(total)}</strong></div></div></div></div>;
  }
  if (kind === 'line') {
    const w = 760, h = 240, p = 28;
    const coords = rows.map((row, i) => ({ x: p + (i / Math.max(rows.length - 1, 1)) * (w - p * 2), y: h - p - (row.valueCents / maxVal) * (h - p * 2) }));
    const d = coords.map((pt, i) => `${i ? 'L' : 'M'}${pt.x},${pt.y}`).join(' ');
    return <svg role="img" aria-label="Grafico de barras" viewBox={`0 0 ${w} ${h}`} className="h-[250px] w-full"><defs><linearGradient id="explore-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".2"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>{[0,1,2,3].map(i => <line key={i} x1={p} x2={w-p} y1={p+i*((h-p*2)/3)} y2={p+i*((h-p*2)/3)} stroke="var(--line)" strokeDasharray="4 6"/>)}<path d={`${d} L${coords.at(-1)?.x ?? p},${h-p} L${coords[0]?.x ?? p},${h-p} Z`} fill="url(#explore-area)"/><path d={d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{coords.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r="5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3"/>)}</svg>;
  }
  return <div role="img" aria-label="Grafico de barras" className="flex h-[250px] items-end gap-3 px-2 pt-8 sm:gap-5">{rows.map((r, i) => { const height = Math.max((r.valueCents / maxVal) * 100, 4); return <div key={r.key} className="group relative flex h-full flex-1 items-end"><div className="w-full rounded-t-[14px] border border-accent/10 bg-[linear-gradient(180deg,var(--accent),color-mix(in_oklch,var(--accent),var(--brand-violet)_42%))] shadow-[0_10px_28px_color-mix(in_oklch,var(--accent),transparent_88%)] transition-[height,filter] duration-500 group-hover:brightness-105" style={{ height: `${height}%`, opacity: 1 - i * .08 }} title={`${r.label}: ${formatCents(r.valueCents)}`} /></div>; })}</div>;
}

function ExplorarSkeleton() { return <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1280px] gap-6" role="status" aria-label="Carregando explorador"><div className="flex items-center justify-between"><Skeleton variant="text" width="160px" height="34px" /><Skeleton variant="text" width="120px" height="36px" /></div><Skeleton variant="card" height="68px"/><Skeleton variant="card" height="310px"/><Skeleton variant="card" height="220px"/></div>; }

export function Explorar(p: ExplorarProps) {
  const [rows, setRows] = useState<ExploreRow[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { let active = true; setLoading(true); void p.carregarDados(p.filters).then((r) => { if (!active) return; setRows(r.rows); setFreshness(r.freshness); setLoading(false); }); return () => { active = false; }; }, [p.carregarDados, p.filters]);
  const total = useMemo(() => rows.reduce((acc, row) => acc + row.valueCents, 0), [rows]);
  const volume = useMemo(() => rows.reduce((acc, row) => acc + row.count, 0), [rows]);
  if (loading && rows.length === 0) return <ExplorarSkeleton />;

  return <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1280px] gap-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><span className="cadencia-eyebrow"><Sparkle size={11} weight="fill"/> análise livre</span><h1 className="m-0 mt-2 text-[clamp(1.8rem,3.2vw,2.7rem)] font-semibold leading-none tracking-[-.05em]">Explorar</h1><p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Combine recortes, compare sinais e salve as leituras que viram rotina de decisão.</p></div><Botao variante="secundario" altura={40} iconeEsquerda={FloppyDisk} onClick={() => { void p.aoSalvarVisao('Nova visao', p.filters, p.chartKind); }}>Salvar visao</Botao></header>

    <section className="cadencia-panel overflow-hidden p-2"><div role="tablist" aria-label="Visoes salvas" className="flex gap-1 overflow-x-auto scrollbar-thin">{p.savedViews.map((v)=><button key={v.viewId} role="tab" type="button" aria-selected={false} onClick={()=>p.aoSelecionarVisao(v.viewId)} className="shrink-0 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-text-muted transition-all hover:bg-surface-sunken hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">{v.name}</button>)}</div></section>

    <section className="cadencia-panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/70 px-5 py-4 sm:px-6"><div><span className="cadencia-eyebrow">Canvas analítico</span><div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1"><h2 className="m-0 text-base font-semibold tracking-[-.025em]">Resultado</h2><span className="num text-xs font-semibold text-text-muted">{volume} eventos · {formatCents(total)}</span></div></div><div role="radiogroup" aria-label="Tipo de grafico" className="cadencia-segmented p-1">{(['bar','line','pie'] as const).map((kind)=>{const Icon=CHART_ICONS[kind];return <button key={kind} role="radio" type="button" aria-checked={p.chartKind===kind} aria-label={CHART_LABELS[kind]} onClick={()=>p.aoMudarGrafico(kind)} className={cn('flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[11px] font-semibold transition-all',p.chartKind===kind?'bg-surface text-accent shadow-elev-1':'text-text-muted hover:text-text')}><Icon size={14} weight={p.chartKind===kind?'fill':'regular'}/><span className="hidden sm:inline">{CHART_LABELS[kind]}</span></button>})}</div></div><div className="p-4 sm:p-6"><ExplorerVisual rows={rows} kind={p.chartKind}/></div>{freshness?.source==='matview'&&freshness.refreshedAt?<div className="border-t border-line/70 px-5 py-3 text-[9px] font-bold uppercase tracking-[.09em] text-text-faint sm:px-6">dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}</div>:null}</section>

    <section aria-label="Tabela de dados" className="cadencia-data-grid overflow-hidden"><div className="border-b border-line/70 px-5 py-4 sm:px-6"><span className="cadencia-eyebrow">Dados subjacentes</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Leitura detalhada</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-[13px]"><thead><tr><th className="border-b border-line/70 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Item</th><th className="border-b border-line/70 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Qtd</th><th className="border-b border-line/70 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">Valor</th></tr></thead><tbody>{rows.map((r)=><tr key={r.key} className="hover:bg-accent-soft/30"><td className="border-b border-line/70 px-4 py-3.5 font-semibold">{r.label}</td><td className="num border-b border-line/70 px-4 py-3.5 text-right tabular-nums text-text-muted">{r.count}</td><td className="num border-b border-line/70 px-4 py-3.5 text-right font-semibold tabular-nums">{formatCents(r.valueCents)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
