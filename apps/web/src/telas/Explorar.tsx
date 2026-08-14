// apps/web/src/telas/Explorar.tsx
'use client';

import { useCallback, useState } from 'react';
import { Botao } from '../ui/Botao';
import { GraficoExplorar } from '../ui/GraficoExplorar';
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
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mês/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descrição CID',
  referral_source: 'Indicação',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa horário',
  last_visit_date: 'Última visita',
  return_due_date: 'Retorno previsto',
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
        view: visao.view,
        filters: filtros,
        columns: visao.columns,
        sort: visao.sort,
        limit: 200,
        offset: 0,
      });
      setResultado(res);
    } finally {
      setCarregando(false);
    }
  }, [p, dataInicio, dataFim]);

  const exportar = useCallback(async (format: ExportFormat) => {
    if (visaoAtual === null) return;
    await p.aoExportar({
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      format,
    });
  }, [p, visaoAtual]);

  const salvarVisao = useCallback(async () => {
    if (visaoAtual === null || nomeVisao.trim() === '') return;
    await p.aoSalvarVisao({
      name: nomeVisao,
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      chartKind: visaoAtual.chartKind,
    });
    setSalvando(false);
    setNomeVisao('');
  }, [p, visaoAtual, nomeVisao]);

  const colunas = visaoAtual !== null
    ? visaoAtual.columns.visible
    : [];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Explorar
      </h1>

      {/* Visões salvas */}
      <section aria-label="Visões salvas" style={{ display: 'flex', flexWrap: 'wrap',
                                                    gap: 'var(--s-3)' }}>
        {p.visoesSalvas.map((v) => (
          <Botao key={v.id} variante="secundario" altura={32}
            onClick={() => { void consultar(v); }}>
            {v.name}
          </Botao>
        ))}
      </section>

      {/* Filtros de período */}
      <section aria-label="Filtros" style={{ display: 'flex', gap: 'var(--s-4)',
                                              alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="data-inicio"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data início
          </label>
          <input id="data-inicio" type="date" value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: '1px solid var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <div>
          <label htmlFor="data-fim"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data fim
          </label>
          <input id="data-fim" type="date" value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: '1px solid var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <Botao variante="secundario" altura={32}
          onClick={() => { if (visaoAtual !== null) void consultar(visaoAtual); }}>
          Aplicar filtro
        </Botao>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-2)' }}>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('csv'); }}>
            CSV
          </Botao>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('xlsx'); }}>
            XLSX
          </Botao>
        </div>
      </section>

      {/* Gráfico */}
      {resultado !== null && visaoAtual !== null && visaoAtual.chartKind !== 'table' ? (
        <section aria-label="Gráfico" style={{ overflowX: 'auto' }}>
          <GraficoExplorar
            tipo={visaoAtual.chartKind}
            dados={
              visaoAtual.columns.groupBy !== undefined
                ? resultado.rows.map((row) => ({
                    label: String(row[visaoAtual.columns.groupBy!] ?? ''),
                    value: Number(
                      row[
                        visaoAtual.columns.aggregate !== undefined
                          ? `${visaoAtual.columns.aggregate.fn}_${visaoAtual.columns.aggregate.column}`
                          : visaoAtual.columns.visible[0]!
                      ] ?? 0,
                    ),
                  }))
                : resultado.rows.map((row) => ({
                    label: String(row[colunas[0]!] ?? ''),
                    value: Number(row[colunas[colunas.length - 1]!] ?? 0),
                  }))
            }
            largura={600}
            altura={260}
          />
        </section>
      ) : null}

      {/* Tabela de resultados */}
      {resultado !== null && colunas.length > 0 ? (
        <section aria-label="Resultado" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-14)' }}>
            <thead>
              <tr>
                {colunas.map((col) => (
                  <th key={col} scope="col"
                    style={{ textAlign: 'left', padding: 'var(--s-3) var(--s-4)',
                             borderBottom: '2px solid var(--line-strong)',
                             fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-12)',
                             color: 'var(--text-muted)', textTransform: 'uppercase',
                             letterSpacing: '.04em' }}>
                    {HEADER_MAP[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultado.rows.map((row, i) => (
                <tr key={i}>
                  {colunas.map((col) => (
                    <td key={col}
                      style={{ padding: 'var(--s-3) var(--s-4)',
                               borderBottom: 'var(--border)' }}>
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                      marginTop: 'var(--s-3)' }}>
            {resultado.total} resultado{resultado.total !== 1 ? 's' : ''}
          </p>
        </section>
      ) : carregando ? (
        <div role="status" aria-busy="true" aria-label="Carregando dados" data-testid="explorar-skeleton" className="space-y-3">
          <Skeleton variant="text" width="60%" height="16px" />
          <Skeleton variant="table-row" />
          <Skeleton variant="table-row" />
          <Skeleton variant="table-row" />
          <Skeleton variant="table-row" />
        </div>
      ) : null}

      {/* Salvar visão */}
      {visaoAtual !== null ? (
        <section aria-label="Salvar visão" style={{ display: 'flex', gap: 'var(--s-3)',
                                                     alignItems: 'end' }}>
          {salvando ? (
            <>
              <div>
                <label htmlFor="nome-visao"
                  style={{ display: 'block', fontSize: 'var(--fs-12)',
                           color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
                  Nome da visão
                </label>
                <input id="nome-visao" type="text" value={nomeVisao}
                  onChange={(e) => setNomeVisao(e.target.value)}
                  style={{ padding: 'var(--s-2) var(--s-3)', border: '1px solid var(--border)',
                           borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                           background: 'var(--surface)', color: 'var(--text)',
                           minWidth: 200 }} />
              </div>
              <Botao variante="primario" altura={32}
                onClick={() => { void salvarVisao(); }}>
                Confirmar
              </Botao>
              <Botao variante="fantasma" altura={32}
                onClick={() => { setSalvando(false); setNomeVisao(''); }}>
                Cancelar
              </Botao>
            </>
          ) : (
            <Botao variante="secundario" altura={32}
              onClick={() => setSalvando(true)}>
              Salvar visão
            </Botao>
          )}
        </section>
      ) : null}
    </div>
  );
}
