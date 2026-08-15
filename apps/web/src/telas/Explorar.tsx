// apps/web/src/telas/Explorar.tsx
'use client';

import { useCallback, useState } from 'react';
import { ChartBar, DownloadSimple, FloppyDisk, Funnel, Table } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { GraficoExplorar } from '../ui/GraficoExplorar';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
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
  birth_month_day: 'Mês/Dia', phone: 'Telefone', age: 'Idade', cid_code: 'CID', cid_description: 'Descrição CID',
  referral_source: 'Indicação', day_of_week: 'Dia da semana', time_slot: 'Faixa horário',
  last_visit_date: 'Última visita', return_due_date: 'Retorno previsto',
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
      const res = await p.aoConsultar({ view: visao.view, filters: filtros, columns: visao.columns, sort: visao.sort, limit: 200, offset: 0 });
      setResultado(res);
    } finally {
      setCarregando(false);
    }
  }, [p, dataInicio, dataFim]);

  const exportar = useCallback(async (format: ExportFormat) => {
    if (visaoAtual === null) return;
    await p.aoExportar({ view: visaoAtual.view, filters: visaoAtual.filters, columns: visaoAtual.columns, sort: visaoAtual.sort, format });
  }, [p, visaoAtual]);

  const salvarVisao = useCallback(async () => {
    if (visaoAtual === null || nomeVisao.trim() === '') return;
    await p.aoSalvarVisao({ name: nomeVisao, view: visaoAtual.view, filters: visaoAtual.filters, columns: visaoAtual.columns, sort: visaoAtual.sort, chartKind: visaoAtual.chartKind });
    setSalvando(false);
    setNomeVisao('');
  }, [p, visaoAtual, nomeVisao]);

  const colunas = visaoAtual !== null ? visaoAtual.columns.visible : [];

  return (
    <div className="cadencia-page grid gap-5 pb-28 md:pb-12">
      <PageHeader
        titulo="Explorar"
        eyebrow="Inteligência clínica"
        subtitulo="Transforme a operação em respostas sem perder rastreabilidade da origem dos dados."
        semBreadcrumb
      />

      <section aria-label="Visões salvas" className="cadencia-card rounded-[18px] p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent"><ChartBar size={16} aria-hidden /></span>
          <div><h2 className="text-sm font-bold text-text">Visões rápidas</h2><p className="text-[11px] text-text-faint">Comece por uma pergunta recorrente da gestão.</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.visoesSalvas.map((v) => (
            <Botao key={v.id} variante={visaoAtual?.id === v.id ? 'primario' : 'secundario'} tamanho="sm" onClick={() => { void consultar(v); }}>
              {v.name}
            </Botao>
          ))}
        </div>
      </section>

      <section aria-label="Filtros" className="cadencia-card rounded-[18px] p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Campo rotulo="Data inicial" id="data-inicio" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <Campo rotulo="Data final" id="data-fim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Botao variante="secundario" iconeEsquerda={Funnel} onClick={() => { if (visaoAtual !== null) void consultar(visaoAtual); }}>Aplicar filtro</Botao>
            <span className="hidden h-7 w-px bg-line sm:block" aria-hidden />
            <Botao variante="fantasma" tamanho="sm" iconeEsquerda={DownloadSimple} onClick={() => { void exportar('csv'); }}>CSV</Botao>
            <Botao variante="fantasma" tamanho="sm" iconeEsquerda={DownloadSimple} onClick={() => { void exportar('xlsx'); }}>XLSX</Botao>
          </div>
        </div>
      </section>

      {resultado !== null && visaoAtual !== null && visaoAtual.chartKind !== 'table' ? (
        <section aria-label="Gráfico" className="cadencia-card overflow-x-auto rounded-[18px] p-5 scrollbar-thin">
          <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-sm font-bold text-text">Visualização</h2><span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-bold text-accent">{resultado.total} registros</span></div>
          <GraficoExplorar
            tipo={visaoAtual.chartKind}
            dados={visaoAtual.columns.groupBy !== undefined
              ? resultado.rows.map((row) => ({ label: String(row[visaoAtual.columns.groupBy!] ?? ''), value: Number(row[visaoAtual.columns.aggregate !== undefined ? `${visaoAtual.columns.aggregate.fn}_${visaoAtual.columns.aggregate.column}` : visaoAtual.columns.visible[0]!] ?? 0) }))
              : resultado.rows.map((row) => ({ label: String(row[colunas[0]!] ?? ''), value: Number(row[colunas[colunas.length - 1]!] ?? 0) }))}
            largura={600}
            altura={260}
          />
        </section>
      ) : null}

      {resultado !== null && colunas.length > 0 ? (
        <section aria-label="Resultado" className="cadencia-table-shell overflow-hidden rounded-[18px]">
          <div className="flex items-center justify-between gap-4 border-b border-line bg-[linear-gradient(180deg,var(--surface),var(--surface-subtle))] px-5 py-4">
            <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-surface-sunken text-text-muted"><Table size={16} aria-hidden /></span><div><h2 className="text-sm font-bold text-text">Resultado</h2><p className="text-[11px] text-text-faint">{resultado.total} resultado{resultado.total !== 1 ? 's' : ''}</p></div></div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="clinical-table w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  {colunas.map((col) => <th key={col} scope="col" className="border-b border-line px-4 py-3 text-left">{HEADER_MAP[col] ?? col}</th>)}
                </tr>
              </thead>
              <tbody>
                {resultado.rows.map((row, i) => (
                  <tr key={i} className="transition-colors hover:bg-surface-hover">
                    {colunas.map((col) => <td key={col} className="border-b border-line px-4 py-3 text-text last:border-b-0">{String(row[col] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : carregando ? (
        <div role="status" aria-busy="true" aria-label="Carregando dados" data-testid="explorar-skeleton" className="cadencia-card space-y-3 rounded-[18px] p-5">
          <Skeleton variant="text" width="60%" height="16px" decorativo />
          <Skeleton variant="table-row" decorativo /><Skeleton variant="table-row" decorativo /><Skeleton variant="table-row" decorativo /><Skeleton variant="table-row" decorativo />
        </div>
      ) : null}

      {visaoAtual !== null ? (
        <section aria-label="Salvar visão" className="cadencia-card flex flex-col gap-3 rounded-[18px] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div><p className="cadencia-kicker">Personalização</p><h2 className="mt-1 text-sm font-bold text-text">Salvar esta análise</h2></div>
          {salvando ? (
            <div className="flex flex-1 flex-col gap-2 sm:max-w-xl sm:flex-row sm:items-end sm:justify-end">
              <Campo rotulo="Nome da visão" id="nome-visao" type="text" value={nomeVisao} onChange={(e) => setNomeVisao(e.target.value)} className="w-full sm:max-w-xs" />
              <div className="flex gap-2"><Botao iconeEsquerda={FloppyDisk} onClick={() => { void salvarVisao(); }}>Confirmar</Botao><Botao variante="fantasma" onClick={() => { setSalvando(false); setNomeVisao(''); }}>Cancelar</Botao></div>
            </div>
          ) : (
            <Botao variante="secundario" iconeEsquerda={FloppyDisk} onClick={() => setSalvando(true)}>Salvar visão</Botao>
          )}
        </section>
      ) : null}
    </div>
  );
}
