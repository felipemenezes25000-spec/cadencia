'use client';

import { useState } from 'react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';

type Dataset = 'pacientes' | 'equipe' | 'agendamentos' | 'financeiro';
type Format = 'csv' | 'xlsx';

export interface ExportarDadosRequest {
  readonly dataset: Dataset;
  readonly format: Format;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

export interface ExportarDadosProps {
  readonly aoExportar: (req: ExportarDadosRequest) => Promise<void>;
}

const DATASETS: readonly { value: Dataset; label: string }[] = [
  { value: 'pacientes', label: 'Pacientes' },
  { value: 'equipe', label: 'Equipe' },
  { value: 'agendamentos', label: 'Agendamentos' },
  { value: 'financeiro', label: 'Financeiro' },
];

const DATASETS_COM_PERIODO: readonly Dataset[] = ['agendamentos', 'financeiro'];

export function ExportarDados(p: ExportarDadosProps) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [format, setFormat] = useState<Format>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const precisaPeriodo = dataset !== null
    && (DATASETS_COM_PERIODO as readonly string[]).includes(dataset);

  const periodoValido = !precisaPeriodo || (dateFrom !== '' && dateTo !== '');

  const canExport = dataset !== null && periodoValido && !exporting;

  async function handleExport(): Promise<void> {
    if (dataset === null) return;
    setExporting(true);
    try {
      await p.aoExportar({
        dataset,
        format,
        ...(precisaPeriodo ? { dateFrom, dateTo } : {}),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="cadencia-page grid gap-6 max-w-[640px]">
      <h1 className="m-0 text-[var(--fs-22)] font-semibold leading-tight">
        Exportar Dados
      </h1>

      <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
        <legend className="px-1 text-[var(--fs-15)] font-semibold">
          Dados
        </legend>
        <div
          role="radiogroup"
          aria-label="Selecionar dados"
          className="mt-2 grid gap-2"
        >
          {DATASETS.map((d) => (
            <label
              key={d.value}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2',
                'text-[var(--fs-14)] transition-colors-fast',
                'hover:bg-surface-raised',
              )}
            >
              <input
                type="radio"
                name="export-dataset"
                value={d.value}
                aria-label={d.label}
                checked={dataset === d.value}
                onChange={() => setDataset(d.value)}
                className="accent-accent"
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

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

      {precisaPeriodo ? (
        <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
          <legend className="px-1 text-[var(--fs-15)] font-semibold">
            Periodo
          </legend>
          <div className="mt-2 flex gap-4">
            <div>
              <label
                htmlFor="exportar-date-from"
                className="mb-0.5 block text-[var(--fs-12)] text-text-muted"
              >
                De
              </label>
              <input
                id="exportar-date-from"
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
                htmlFor="exportar-date-to"
                className="mb-0.5 block text-[var(--fs-12)] text-text-muted"
              >
                Ate
              </label>
              <input
                id="exportar-date-to"
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
      ) : null}

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
