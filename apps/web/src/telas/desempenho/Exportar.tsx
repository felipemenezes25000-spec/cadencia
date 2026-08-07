// apps/web/src/telas/desempenho/Exportar.tsx
'use client';

import { useState } from 'react';
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
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Exportar
      </h1>

      {p.freshness.source === 'matview' && p.freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(p.freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Selecao de visao */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Visao
        </legend>
        <div role="radiogroup" aria-label="Selecionar visao"
          style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
          {p.savedViews.map((v) => (
            <label key={v.viewId}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer',
                       padding: `var(--s-2) 0` }}>
              <input type="radio" name="export-view" value={v.viewId}
                aria-label={v.name}
                checked={selectedView === v.viewId}
                onChange={() => setSelectedView(v.viewId)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Selecao de formato */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Formato
        </legend>
        <div role="radiogroup" aria-label="Selecionar formato"
          style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          {(['csv', 'xlsx'] as const).map((f) => (
            <label key={f}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer' }}>
              <input type="radio" name="export-format" value={f}
                aria-label={f.toUpperCase()}
                checked={format === f}
                onChange={() => setFormat(f)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Periodo */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Periodo
        </legend>
        <div style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          <div>
            <label htmlFor="export-date-from"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              De
            </label>
            <input id="export-date-from" type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
          <div>
            <label htmlFor="export-date-to"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              Ate
            </label>
            <input id="export-date-to" type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
        </div>
      </fieldset>

      <Botao variante="primario" altura={40}
        disabled={!canExport}
        carregando={exporting}
        onClick={() => { void handleExport(); }}>
        Exportar
      </Botao>
    </div>
  );
}
