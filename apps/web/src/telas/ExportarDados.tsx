'use client';

import { useState } from 'react';
import {
  CalendarBlank,
  DownloadSimple,
  ShieldCheck,
  UsersThree,
  Wallet,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
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

interface DatasetOption {
  readonly value: Dataset;
  readonly label: string;
  readonly description: string;
  readonly icon: PhosphorIcon;
}

const DATASETS: readonly DatasetOption[] = [
  { value: 'pacientes', label: 'Pacientes', description: 'Cadastro e dados operacionais', icon: UsersThree },
  { value: 'equipe', label: 'Equipe', description: 'Vínculos e perfis da unidade', icon: ShieldCheck },
  { value: 'agendamentos', label: 'Agendamentos', description: 'Agenda dentro de um período', icon: CalendarBlank },
  { value: 'financeiro', label: 'Financeiro', description: 'Movimentações dentro de um período', icon: Wallet },
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
  const selecionado = DATASETS.find((item) => item.value === dataset) ?? null;

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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div className="grid gap-5">
        <section>
          <div className="mb-3">
            <h2 className="m-0 text-[14px] font-semibold text-text">Escolha o que deseja exportar</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-text-faint">Gere um arquivo portátil sem alterar nenhum dado da operação.</p>
          </div>
          <div role="radiogroup" aria-label="Selecionar dados" className="grid gap-2 sm:grid-cols-2">
            {DATASETS.map((item) => {
              const Icon = item.icon;
              const ativo = dataset === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setDataset(item.value)}
                  className={cn(
                    'group flex min-h-[82px] items-center gap-3 rounded-[11px] border p-3.5 text-left transition-all-fast',
                    ativo
                      ? 'border-accent/30 bg-accent-soft/45 ring-1 ring-accent/10'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-subtle',
                  )}
                >
                  <span className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-[11px] transition-colors-fast',
                    ativo ? 'bg-surface text-accent shadow-elev-1' : 'bg-surface-sunken text-text-muted group-hover:text-accent',
                  )}>
                    <Icon size={19} weight="duotone" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <strong className={cn('block text-[13px] font-semibold', ativo ? 'text-accent' : 'text-text')}>{item.label}</strong>
                    <span className="mt-1 block text-[10px] leading-relaxed text-text-faint">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-[12px] border border-line bg-surface p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:items-start">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Formato do arquivo</p>
              <div role="radiogroup" aria-label="Selecionar formato" className="mt-2 inline-flex rounded-[10px] border border-line bg-surface-subtle p-1">
                {(['csv', 'xlsx'] as const).map((valor) => (
                  <button
                    key={valor}
                    type="button"
                    role="radio"
                    aria-checked={format === valor}
                    onClick={() => setFormat(valor)}
                    className={cn(
                      'min-w-[74px] rounded-[7px] px-3 py-2 text-[11px] font-bold uppercase transition-all-fast',
                      format === valor ? 'bg-surface text-accent shadow-elev-1' : 'text-text-muted hover:text-text',
                    )}
                  >
                    {valor}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-text-faint">CSV é leve e universal. XLSX preserva melhor a leitura em planilhas.</p>
            </div>

            <div className={cn(!precisaPeriodo && 'opacity-45')}>
              <p className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Período</p>
              {precisaPeriodo ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-[10px] font-semibold text-text-muted">
                    De
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-10 rounded-[9px] border border-line-field bg-surface px-3 text-xs text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-[10px] font-semibold text-text-muted">
                    Até
                    <input
                      type="date"
                      value={dateTo}
                      {...(dateFrom !== '' ? { min: dateFrom } : {})}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-10 rounded-[9px] border border-line-field bg-surface px-3 text-xs text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 flex min-h-10 items-center rounded-[9px] border border-dashed border-line px-3 text-[10px] text-text-faint">
                  {dataset === null ? 'Selecione um conjunto de dados.' : 'Este conjunto não exige período.'}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <aside className="overflow-hidden rounded-[12px] border border-line bg-surface xl:sticky xl:top-[92px]" aria-label="Resumo da exportação">
        <div className="border-b border-line bg-surface-subtle/65 p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent"><DownloadSimple size={18} weight="duotone" aria-hidden /></span>
            <div>
              <h3 className="m-0 text-[13px] font-semibold text-text">Resumo da exportação</h3>
              <p className="mt-0.5 text-[9px] text-text-faint">Revise antes de gerar o arquivo.</p>
            </div>
          </div>
        </div>

        <dl className="grid gap-0 divide-y divide-line px-4">
          <div className="flex items-center justify-between gap-4 py-3.5"><dt className="text-[10px] text-text-faint">Dados</dt><dd className="text-right text-[11px] font-semibold text-text">{selecionado?.label ?? 'Não selecionado'}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3.5"><dt className="text-[10px] text-text-faint">Formato</dt><dd className="text-[11px] font-semibold uppercase text-text">{format}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3.5"><dt className="text-[10px] text-text-faint">Período</dt><dd className="text-right text-[11px] font-semibold text-text">{precisaPeriodo ? (periodoValido ? `${dateFrom.split('-').reverse().join('/')} → ${dateTo.split('-').reverse().join('/')}` : 'Pendente') : 'Completo'}</dd></div>
        </dl>

        <div className="p-4">
          <div className="mb-3 flex items-start gap-2 rounded-[9px] bg-ok-soft/65 p-2.5 text-[9px] leading-relaxed text-ok">
            <ShieldCheck size={14} weight="duotone" className="mt-0.5 shrink-0" aria-hidden />
            A exportação é somente leitura e não modifica registros da clínica.
          </div>
          <Botao
            variante="primario"
            fullWidth
            iconeEsquerda={DownloadSimple}
            disabled={!canExport}
            carregando={exporting}
            onClick={() => handleExport()}
          >
            Gerar arquivo
          </Botao>
        </div>
      </aside>
    </div>
  );
}
