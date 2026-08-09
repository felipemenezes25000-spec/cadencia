'use client';

import { useState } from 'react';
import { CalendarBlank, Check, FileCsv, FileXls, Package, ShieldCheck } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Botao } from '../../ui/Botao';
import type { SavedView, ExportFormat, DataFreshness } from './types';

export interface ExportRequest { readonly viewId: string; readonly format: ExportFormat; readonly dateFrom: string; readonly dateTo: string; }
export interface ExportarProps { readonly savedViews: readonly SavedView[]; readonly freshness: DataFreshness; readonly aoExportar: (request: ExportRequest) => Promise<void>; }

export function Exportar(p: ExportarProps) {
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  async function handleExport() { if (!selectedView) return; setExporting(true); try { await p.aoExportar({ viewId: selectedView, format, dateFrom, dateTo }); } finally { setExporting(false); } }
  const canExport = selectedView !== null && !exporting;

  return <div className="cadencia-page cadencia-enter mx-auto grid max-w-[980px] gap-6">
    <header><span className="cadencia-eyebrow">Portabilidade de dados</span><h1 className="m-0 mt-2 text-[clamp(1.8rem,3.2vw,2.7rem)] font-semibold leading-none tracking-[-.05em]">Exportar</h1><p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Monte um pacote de análise rastreável, no formato certo e com o recorte temporal exato.</p>{p.freshness.source==='matview'&&p.freshness.refreshedAt?<p className="m-0 mt-3 text-[9px] font-bold uppercase tracking-[.09em] text-text-faint">dados ate {new Date(p.freshness.refreshedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}</p>:null}</header>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div className="grid gap-5">
        <fieldset className="cadencia-panel p-5 sm:p-6"><legend className="px-1 text-sm font-semibold">Visao</legend><p className="m-0 mt-1 text-xs text-text-muted">Escolha a análise que será materializada no arquivo.</p><div role="radiogroup" aria-label="Selecionar visao" className="mt-4 grid gap-2 sm:grid-cols-2">{p.savedViews.map((v)=><label key={v.viewId} className={cn('relative flex min-h-[74px] cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-all',selectedView===v.viewId?'border-accent/35 bg-accent-soft shadow-[0_8px_24px_color-mix(in_oklch,var(--accent),transparent_92%)]':'border-line/70 bg-surface/70 hover:border-line-strong hover:bg-surface-raised')}><input type="radio" name="export-view" value={v.viewId} aria-label={v.name} checked={selectedView===v.viewId} onChange={()=>setSelectedView(v.viewId)} className="sr-only"/><span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl',selectedView===v.viewId?'bg-accent text-white':'bg-surface-sunken text-text-muted')}>{selectedView===v.viewId?<Check size={16} weight="bold"/>:<Package size={16}/>}</span><span className="min-w-0 text-xs font-semibold leading-snug text-text">{v.name}</span></label>)}</div></fieldset>

        <fieldset className="cadencia-panel p-5 sm:p-6"><legend className="px-1 text-sm font-semibold">Formato</legend><div role="radiogroup" aria-label="Selecionar formato" className="mt-3 grid grid-cols-2 gap-3">{(['csv','xlsx'] as const).map((f)=>{const Icon=f==='csv'?FileCsv:FileXls;return <label key={f} className={cn('flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-all',format===f?'border-accent/35 bg-accent-soft':'border-line/70 bg-surface hover:border-line-strong')}><input type="radio" name="export-format" value={f} aria-label={f.toUpperCase()} checked={format===f} onChange={()=>setFormat(f)} className="sr-only"/><span className={cn('grid h-10 w-10 place-items-center rounded-xl',format===f?'bg-accent text-white':'bg-surface-sunken text-text-muted')}><Icon size={20} weight="duotone"/></span><span><strong className="block text-sm">{f.toUpperCase()}</strong><small className="text-[10px] text-text-muted">{f==='csv'?'leve e universal':'planilha estruturada'}</small></span></label>})}</div></fieldset>

        <fieldset className="cadencia-panel p-5 sm:p-6"><legend className="px-1 text-sm font-semibold">Periodo</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{([{id:'export-date-from',label:'De',value:dateFrom,set:setDateFrom},{id:'export-date-to',label:'Ate',value:dateTo,set:setDateTo}] as const).map((field)=><div key={field.id}><label htmlFor={field.id} className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">{field.label}</label><div className="flex h-11 items-center gap-2 rounded-xl border border-line/75 bg-surface px-3 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--surface),white_30%)] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"><CalendarBlank size={16} className="text-text-faint"/><input id={field.id} type="date" value={field.value} onChange={(e)=>field.set(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none"/></div></div>)}</div></fieldset>
      </div>

      <aside className="cadencia-panel cadencia-sticky-rail h-fit overflow-hidden p-5"><span className="cadencia-eyebrow">Pacote pronto</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Resumo da exportação</h2><div className="mt-5 grid gap-3 text-xs"><div className="rounded-2xl bg-surface-sunken/70 p-3"><span className="text-text-faint">Visão</span><strong className="mt-1 block text-text">{p.savedViews.find((v)=>v.viewId===selectedView)?.name ?? 'Selecione uma visão'}</strong></div><div className="grid grid-cols-2 gap-2"><div className="rounded-2xl bg-surface-sunken/70 p-3"><span className="text-text-faint">Formato</span><strong className="mt-1 block text-text">{format.toUpperCase()}</strong></div><div className="rounded-2xl bg-surface-sunken/70 p-3"><span className="text-text-faint">Período</span><strong className="mt-1 block text-text">{dateFrom&&dateTo?'Definido':'Completo'}</strong></div></div><div className="flex gap-2 rounded-2xl border border-ok/15 bg-ok-soft/55 p-3 text-[11px] leading-relaxed text-text-muted"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-ok" weight="duotone"/>A exportação preserva o recorte escolhido e não altera os dados da clínica.</div></div><Botao className="mt-5 w-full" variante="primario" altura={40} disabled={!canExport} carregando={exporting} onClick={()=>{void handleExport();}}>Exportar</Botao></aside>
    </div>
  </div>;
}
