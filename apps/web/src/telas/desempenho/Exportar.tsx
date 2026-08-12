// apps/web/src/telas/desempenho/Exportar.tsx
'use client';

import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Botao } from '../../ui/Botao';
import type { SavedView, ExportFormat, DataFreshness } from './types';

export interface ExportRequest {
  readonly viewId: string;
  readonly format: ExportFormat;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface ExportarProps {
  readonly savedViews: readonly SavedView[];
  readonly freshness: DataFreshness;
  readonly aoExportar: (request: ExportRequest) => Promise<void>;
}

export function Exportar(p: ExportarProps) {
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (selectedView === null) return;
    setExporting(true);
    try {
      await p.aoExportar({ viewId: selectedView, format, dateFrom, dateTo });
    } finally {
      setExporting(false);
    }
  }

  const canExport = selectedView !== null && !exporting;

  return (
    <div className="cadencia-page grid gap-6 max-w-[640px]">
      <h1 className="m-0 text-[var(--fs-22)] font-semibold leading-tight">
        Exportar
      </h1>

      {p.freshness.source === 'matview' && p.freshness.refreshedAt !== null ? (
        <p className="m-0 text-[var(--fs-11)] uppercase tracking-[.04em] text-text-faint">
          dados até {new Date(p.freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Seleção de visão */}
      <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
        <legend className="px-1 text-[var(--fs-15)] font-semibold">
          Visão
        </legend>
        <div
          role="radiogroup"
          aria-label="Selecionar visão"
          className="mt-2 grid gap-2"
        >
          {p.savedViews.map((v) => (
            <label
              key={v.viewId}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors-fast',
                'text-[var(--fs-14)] transition-colors-fast',
                'hover:bg-surface-raised',
              )}
            >
              <input
                type="radio"
                name="export-view"
                value={v.viewId}
                aria-label={v.name}
                checked={selectedView === v.viewId}
                onChange={() => setSelectedView(v.viewId)}
                className="accent-accent"
              />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Seleção de formato */}
      <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
        <legend className="px-1 text-[var(--fs-15)] font-semibold">
          Formato
        </legend>
        <div
          role="radiogroup"
          aria-label="Selecionar formato"
          className="mt-2 flex gap-4"
        >
          {(['csv', 'xlsx'] as const).map((f) => (
            <label
              key={f}
              className={cn(
                'flex cursor-pointer items-center gap-1.5',
                'text-[var(--fs-14)] transition-colors-fast',
              )}
            >
              <input
                type="radio"
                name="export-format"
                value={f}
                aria-label={f.toUpperCase()}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="accent-accent"
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Período */}
      <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
        <legend className="px-1 text-[var(--fs-15)] font-semibold">
          Período
        </legend>
        <div className="mt-2 flex gap-4">
          <div>
            <label
              htmlFor="export-date-from"
              className="mb-0.5 block text-[var(--fs-12)] text-text-muted"
            >
              De
            </label>
            <input
              id="export-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={cn(
                'rounded-lg border border-line bg-surface px-2.5 py-2',
                'text-[var(--fs-14)] text-text',
                'transition-colors-fast',
                'focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none',
              )}
            />
          </div>
          <div>
            <label
              htmlFor="export-date-to"
              className="mb-0.5 block text-[var(--fs-12)] text-text-muted"
            >
              Até
            </label>
            <input
              id="export-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className={cn(
                'rounded-lg border border-line bg-surface px-2.5 py-2',
                'text-[var(--fs-14)] text-text',
                'transition-colors-fast',
                'focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none',
              )}
            />
          </div>
        </div>
      </fieldset>

      <Botao
        variante="primario"
        altura={40}
        disabled={!canExport}
        carregando={exporting}
        onClick={() => { void handleExport(); }}
      >
        Exportar
      </Botao>
    </div>
  );
}
