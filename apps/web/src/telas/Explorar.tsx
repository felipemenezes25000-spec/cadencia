// apps/web/src/telas/Explorar.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChartBar,
  DownloadSimple,
  FileCsv,
  FileXls,
  FloppyDisk,
  Funnel,
  Sparkle,
} from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { GraficoExplorar } from '../ui/GraficoExplorar';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../lib/cn';
import type { SavedView, ReportFilter, ReportColumns, ReportSort, ChartKind, ExportFormat } from '@cadencia/reports';

export interface ResultadoConsulta {
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
}

export interface ExplorarProps {
  readonly visoesSalvas: readonly SavedView[];
  readonly aoConsultar: (query: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    limit: number;
    offset: number;
  }) => Promise<ResultadoConsulta>;
  readonly aoExportar: (params: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    format: ExportFormat;
  }) => Promise<void>;
  readonly aoSalvarVisao: (params: {
    name: string;
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    chartKind: ChartKind;
  }) => Promise<{ viewId: string }>;
}

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional', patient_name: 'Paciente', occurred_date: 'Data', status: 'Status',
  procedure_name: 'Procedimento', category_name: 'Categoria', kind: 'Tipo', amount_cents: 'Valor',
  channel: 'Canal', template_name: 'Template', sent_at: 'Enviado em', birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia', phone: 'Telefone', age: 'Idade', cid_code: 'CID', cid_description: 'Descricao CID',
  referral_source: 'Indicacao', day_of_week: 'Dia da semana', time_slot: 'Faixa horario',
  last_visit_date: 'Ultima visita', return_due_date: 'Retorno previsto',
};

export function Explorar(p: ExplorarProps) {
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [visaoAtual, setVisaoAtual] = useState<SavedView | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [nomeVisao, setNomeVisao] = useState('');

  const consultar = useCallback(async (visao: SavedView) => {
    setCarregando(true);
    setVisaoAtual(visao);
    try {
      const filtros = [...visao.filters];
      if (dataInicio !== '' && dataFim !== '') {
        filtros.push({ column: 'occurred_date', op: 'between', value: [dataInicio, dataFim] });
      }
      const res = await p.aoConsultar({
        view: visao.view, filters: filtros, columns: visao.columns, sort: visao.sort, limit: 200, offset: 0,
      });
      setResultado(res);
    } finally {
      setCarregando(false);
    }
  }, [p, dataInicio, dataFim]);

  const exportar = useCallback(async (format: ExportFormat) => {
    if (visaoAtual === null) return;
    await p.aoExportar({
      view: visaoAtual.view, filters: visaoAtual.filters, columns: visaoAtual.columns, sort: visaoAtual.sort, format,
    });
  }, [p, visaoAtual]);

  const salvarVisao = useCallback(async () => {
    if (visaoAtual === null || nomeVisao.trim() === '') return;
    await p.aoSalvarVisao({
      name: nomeVisao, view: visaoAtual.view, filters: visaoAtual.filters, columns: visaoAtual.columns,
      sort: visaoAtual.sort, chartKind: visaoAtual.chartKind,
    });
    setSalvando(false);
    setNomeVisao('');
  }, [p, visaoAtual, nomeVisao]);

  const colunas = visaoAtual?.columns.visible ?? [];
  const periodoAtivo = dataInicio !== '' || dataFim !== '';
  const resumo = useMemo(() => ({
    linhas: resultado?.rows.length ?? 0,
    total: resultado?.total ?? 0,
    colunas: colunas.length,
  }), [resultado, colunas.length]);

  return (
    <div className="cadencia-page p-4 cadencia-enter mx-auto grid max-w-[1320px] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div><span className="cadencia-eyebrow"><Sparkle size={11} weight="fill" /> inteligência sob demanda</span><h1 className="m-0 mt-2 text-[clamp(1.85rem,3vw,2.55rem)] font-semibold leading-none tracking-[-.055em] text-text">Explorar</h1><p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Transforme dados operacionais em decisões, sem sair do fluxo da clínica.</p></div>
      </header>

      <section className="cadencia-panel cadencia-panel-hero overflow-hidden p-5 sm:p-6" aria-label="Visoes salvas">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <span className="cadencia-eyebrow">Ponto de partida</span>
            <h2 className="m-0 mt-2 text-xl font-semibold tracking-[-.035em] text-text sm:text-2xl">Escolha uma pergunta já pronta.</h2>
            <p className="m-0 mt-1.5 text-sm leading-relaxed text-text-muted">As visões carregam filtros, colunas e visualização. Você pode refiná-las antes de salvar uma versão própria.</p>
          </div>
          <div className="cadencia-icon-orb h-11 w-11"><Sparkle size={20} weight="duotone" /></div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {p.visoesSalvas.map((v, index) => {
            const ativo = visaoAtual?.id === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { void consultar(v); }}
                className={cn(
                  'group flex min-h-[72px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200',
                  ativo
                    ? 'border-accent/35 bg-accent-soft shadow-[0_12px_30px_color-mix(in_oklch,var(--accent),transparent_90%)]'
                    : 'border-line/70 bg-surface/80 hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-raised hover:shadow-elev-1',
                )}
              >
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold', ativo ? 'bg-accent text-white' : 'bg-surface-sunken text-text-muted')}>{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-text">{v.name}</strong><small className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[.08em] text-text-faint">{v.builtIn ? 'visão nativa' : 'visão salva'}</small></span>
                <ArrowRight size={15} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="cadencia-panel p-4 sm:p-5" aria-label="Filtros">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-4">
          <div className="flex items-center gap-2"><span className="cadencia-icon-orb h-8 w-8 rounded-xl"><Funnel size={15} weight="duotone" /></span><div><h2 className="m-0 text-sm font-semibold text-text">Janela de análise</h2><p className="m-0 text-[11px] text-text-muted">Refine o recorte temporal sem perder a visão.</p></div></div>
          <div className="flex items-center gap-2">
            {periodoAtivo ? <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] text-accent">filtro ativo</span> : null}
            <Botao variante="fantasma" altura={32} iconeEsquerda={FileCsv} onClick={() => { void exportar('csv'); }}>CSV</Botao>
            <Botao variante="fantasma" altura={32} iconeEsquerda={FileXls} onClick={() => { void exportar('xlsx'); }}>XLSX</Botao>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[.07em] text-text-muted" htmlFor="data-inicio">Data inicio
            <input id="data-inicio" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-text outline-none transition-all focus:border-accent/50 focus:ring-4 focus:ring-accent/10" />
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[.07em] text-text-muted" htmlFor="data-fim">Data fim
            <input id="data-fim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-text outline-none transition-all focus:border-accent/50 focus:ring-4 focus:ring-accent/10" />
          </label>
          <Botao variante="secundario" altura={40} onClick={() => { if (visaoAtual !== null) void consultar(visaoAtual); }} disabled={visaoAtual === null}>Aplicar filtro</Botao>
        </div>
      </section>

      {carregando ? (
        <div role="status" aria-busy="true" aria-label="Carregando dados" data-testid="explorar-skeleton" className="cadencia-panel grid gap-3 p-5">
          <Skeleton variant="text" width="60%" height="16px" /><Skeleton variant="table-row" /><Skeleton variant="table-row" /><Skeleton variant="table-row" /><Skeleton variant="table-row" />
        </div>
      ) : resultado !== null && visaoAtual !== null ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Resumo da consulta">
            <div className="cadencia-metric p-4"><span className="cadencia-eyebrow">Resultado</span><strong className="num mt-2 block text-2xl tracking-[-.05em]">{resumo.total}</strong><small className="text-[11px] text-text-muted">registros encontrados</small></div>
            <div className="cadencia-metric p-4"><span className="cadencia-eyebrow">Amostra</span><strong className="num mt-2 block text-2xl tracking-[-.05em]">{resumo.linhas}</strong><small className="text-[11px] text-text-muted">linhas carregadas</small></div>
            <div className="cadencia-metric p-4"><span className="cadencia-eyebrow">Dimensões</span><strong className="num mt-2 block text-2xl tracking-[-.05em]">{resumo.colunas}</strong><small className="text-[11px] text-text-muted">colunas visíveis</small></div>
            <div className="cadencia-metric p-4"><span className="cadencia-eyebrow">Visão</span><strong className="mt-2 block truncate text-sm font-semibold text-text">{visaoAtual.name}</strong><small className="text-[11px] text-text-muted">contexto em uso</small></div>
          </section>

          {visaoAtual.chartKind !== 'table' ? (
            <section aria-label="Grafico" className="cadencia-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4 sm:px-6"><div><span className="cadencia-eyebrow">Leitura visual</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Padrão do resultado</h2></div><span className="cadencia-icon-orb h-9 w-9"><ChartBar size={17} weight="duotone" /></span></div>
              <div className="overflow-x-auto p-4 sm:p-6"><GraficoExplorar tipo={visaoAtual.chartKind} dados={visaoAtual.columns.groupBy !== undefined ? resultado.rows.map((row) => ({ label: String(row[visaoAtual.columns.groupBy!] ?? ''), value: Number(row[visaoAtual.columns.aggregate !== undefined ? `${visaoAtual.columns.aggregate.fn}_${visaoAtual.columns.aggregate.column}` : visaoAtual.columns.visible[0]!] ?? 0) })) : resultado.rows.map((row) => ({ label: String(row[colunas[0]!] ?? ''), value: Number(row[colunas[colunas.length - 1]!] ?? 0) }))} largura={600} altura={260} /></div>
            </section>
          ) : null}

          {colunas.length > 0 ? (
            <section aria-label="Resultado" className="cadencia-data-grid overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4 sm:px-6">
                <div><span className="cadencia-eyebrow">Dados</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Tabela de resultado</h2></div>
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.07em] text-text-faint"><DownloadSimple size={14} /> exportação pronta</span>
              </div>
              <div className="overflow-x-auto"><table className="min-w-[680px] w-full text-sm"><thead><tr>{colunas.map((col) => <th key={col} scope="col" className="whitespace-nowrap px-5 py-3 text-left text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">{HEADER_MAP[col] ?? col}</th>)}</tr></thead><tbody>{resultado.rows.map((row, i) => <tr key={i} className="transition-colors hover:bg-surface-sunken/60">{colunas.map((col) => <td key={col} className="max-w-[320px] truncate px-5 py-3.5 text-text">{String(row[col] ?? '')}</td>)}</tr>)}</tbody></table></div>
              <div className="border-t border-line/70 px-5 py-3 text-xs text-text-muted">{resultado.total} resultado{resultado.total !== 1 ? 's' : ''}</div>
            </section>
          ) : null}

          <section aria-label="Salvar visao" className="cadencia-panel p-4 sm:p-5">
            {salvando ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"><label htmlFor="nome-visao" className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[.07em] text-text-muted">Nome da visao<input id="nome-visao" type="text" value={nomeVisao} onChange={(e) => setNomeVisao(e.target.value)} placeholder="Ex.: Produção da semana" className="h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-sm font-medium normal-case tracking-normal text-text outline-none transition-all focus:border-accent/50 focus:ring-4 focus:ring-accent/10" /></label><Botao variante="primario" altura={40} iconeEsquerda={FloppyDisk} onClick={() => { void salvarVisao(); }}>Confirmar</Botao><Botao variante="fantasma" altura={40} onClick={() => { setSalvando(false); setNomeVisao(''); }}>Cancelar</Botao></div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="cadencia-eyebrow">Reutilize a descoberta</span><p className="m-0 mt-1 text-sm text-text-muted">Salve este contexto para voltar a ele sem reconstruir filtros.</p></div><Botao variante="secundario" altura={40} iconeEsquerda={FloppyDisk} onClick={() => setSalvando(true)}>Salvar visao</Botao></div>
            )}
          </section>
        </>
      ) : (
        <section className="cadencia-panel grid min-h-[190px] place-items-center p-8 text-center" aria-label="Estado inicial do explorador">
          <div className="max-w-sm"><span className="cadencia-icon-orb mx-auto h-11 w-11"><DownloadSimple size={20} weight="duotone" /></span><h2 className="m-0 mt-4 text-base font-semibold">Comece por uma visão acima</h2><p className="m-0 mt-1.5 text-sm leading-relaxed text-text-muted">O resultado, a leitura visual e as opções de exportação aparecem aqui quando você fizer a primeira consulta.</p></div>
        </section>
      )}
    </div>
  );
}
