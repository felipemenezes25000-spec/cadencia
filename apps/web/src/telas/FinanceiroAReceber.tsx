// apps/web/src/telas/FinanceiroAReceber.tsx
'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import { SortAscending, SortDescending, Receipt, WarningCircle } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';
import { PainelLateral } from '../ui/PainelLateral';
import { EstadoVazio as EstadoVazioCompartilhado } from '../ui/EstadoVazio';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusFinanceiro = 'pendente' | 'vencido' | 'pago';

export interface EntradaPendenteReceber {
  readonly id: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly daysPastDue: number;
  readonly status?: StatusFinanceiro;
  readonly categoryName?: string;
}

export interface AReceberDados {
  readonly total: number;
  readonly entradas: readonly EntradaPendenteReceber[];
}

export interface FinanceiroAReceberProps {
  readonly carregarDados: () => Promise<AReceberDados>;
  readonly aoCobrar: (entryId: string) => Promise<void>;
  readonly aoMarcarPago: (entryId: string) => Promise<void>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
  readonly hoje: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarData(iso: string): string {
  const dateStr = iso.substring(0, 10);
  const [ano, mes, dia] = dateStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

function derivarStatus(e: EntradaPendenteReceber): StatusFinanceiro {
  if (e.status) return e.status;
  return e.daysPastDue > 0 ? 'vencido' : 'pendente';
}

type AgingLevel = 'ok' | 'warn' | 'danger';

function calcularAging(daysPastDue: number): AgingLevel {
  if (daysPastDue > 30) return 'danger';
  if (daysPastDue > 15) return 'warn';
  return 'ok';
}

// ── Ordenação ──────────────────────────────────────────────────────────────

type DirecaoOrdenacao = 'asc' | 'desc';

interface Ordenacao {
  readonly campo: string;
  readonly direcao: DirecaoOrdenacao;
}

function ThSortavel({
  campo,
  rotulo,
  ordenacao,
  onSort,
  className,
}: {
  readonly campo: string;
  readonly rotulo: string;
  readonly ordenacao: Ordenacao | null;
  readonly onSort: (ord: Ordenacao) => void;
  readonly className?: string;
}) {
  const ativo = ordenacao?.campo === campo;
  const direcao = ativo ? ordenacao.direcao : null;

  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-muted',
        'cursor-pointer select-none hover:text-text transition-colors-fast',
        className,
      )}
      aria-sort={ativo ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() =>
        onSort({
          campo,
          direcao: ativo && direcao === 'asc' ? 'desc' : 'asc',
        })
      }
    >
      <span className="inline-flex items-center gap-1">
        {rotulo}
        {ativo && (
          <Icone
            icon={direcao === 'asc' ? SortAscending : SortDescending}
            size="sm"
            className="text-accent"
          />
        )}
      </span>
    </th>
  );
}

// ── Chip de status financeiro ─────────────────────────────────────────────

const STATUS_CONFIG: Record<
  StatusFinanceiro,
  { readonly rotulo: string; readonly glifo: string; readonly classes: string }
> = {
  pendente: { rotulo: 'A vencer', glifo: '◷', classes: 'bg-info-soft text-info' },
  vencido: { rotulo: 'Vencido', glifo: '!', classes: 'bg-danger-soft text-danger' },
  pago: { rotulo: 'Pago', glifo: '✓', classes: 'bg-ok-soft text-ok' },
};

function ChipDeStatusFinanceiro({ status }: { readonly status: StatusFinanceiro }) {
  const c = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        c.classes,
      )}
    >
      <span aria-hidden="true">{c.glifo}</span>{c.rotulo}
    </span>
  );
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function AReceberSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton variant="text" width="120px" height="32px" />
        <Skeleton variant="text" width="120px" height="32px" />
        <Skeleton variant="text" width="120px" height="32px" />
      </div>
      <div className="rounded-lg border border-line overflow-hidden">
        <div className="border-b border-line bg-surface-raised px-4 py-2.5">
          <Skeleton variant="text" width="80%" height="16px" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-line px-4 py-3">
            <Skeleton variant="table-row" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Estado vazio ──────────────────────────────────────────────────────────

function EstadoVazioDaTabela() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icone icon={Receipt} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhum lançamento encontrado
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Ajuste os filtros ou registre um novo recebível para este período.
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAReceber(p: FinanceiroAReceberProps) {
  const baseId = useId();
  const [dados, setDados] = useState<AReceberDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dataInicio, setDataInicio] = useEstadoNaUrl('inicio');
  const [dataFim, setDataFim] = useEstadoNaUrl('fim');
  const [categoriaFiltro, setCategoriaFiltro] = useEstadoNaUrl('categoria');
  const [statusFiltro, setStatusFiltro] = useEstadoNaUrl('status');
  const [busca, setBusca] = useEstadoNaUrl('busca');
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(null);
  const [selecionada, setSelecionada] = useState<EntradaPendenteReceber | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  useEffect(() => {
    setCarregando(true);
    setErroCarregamento(null);
    void p.carregarDados()
      .then((d) => setDados(d))
      .catch(() => {
        setDados(null);
        setErroCarregamento('A listagem não foi carregada. Nenhuma alteração foi realizada.');
      })
      .finally(() => setCarregando(false));
  }, [p.carregarDados, recarga]);

  const categoriasDisponiveis = useMemo(() => {
    if (!dados) return [];
    const cats = new Set(
      dados.entradas
        .map((e) => e.categoryName)
        .filter((c): c is string => c != null),
    );
    return Array.from(cats).sort();
  }, [dados]);

  const entradasFiltradas = useMemo(() => {
    if (!dados) return [];
    let resultado = [...dados.entradas];

    if (busca.trim() !== '') {
      const termo = busca.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
      resultado = resultado.filter((entrada) => `${entrada.patientName} ${entrada.description}`
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(termo));
    }

    if (dataInicio !== '') {
      resultado = resultado.filter((e) => e.dueDate >= dataInicio);
    }
    if (dataFim !== '') {
      resultado = resultado.filter((e) => e.dueDate <= dataFim);
    }

    if (categoriaFiltro !== '') {
      resultado = resultado.filter(
        (e) => (e.categoryName ?? '') === categoriaFiltro,
      );
    }

    if (statusFiltro !== '') {
      resultado = resultado.filter(
        (e) => derivarStatus(e) === statusFiltro,
      );
    }

    if (ordenacao) {
      resultado.sort((a, b) => {
        let cmp = 0;
        switch (ordenacao.campo) {
          case 'data':
            cmp = a.dueDate.localeCompare(b.dueDate);
            break;
          case 'valor':
            cmp = a.amountCents - b.amountCents;
            break;
          default:
            cmp = 0;
        }
        return ordenacao.direcao === 'desc' ? -cmp : cmp;
      });
    }

    return resultado;
  }, [dados, busca, dataInicio, dataFim, categoriaFiltro, statusFiltro, ordenacao]);

  async function executar(acao: (entryId: string) => Promise<void>): Promise<void> {
    if (!selecionada) return;
    setProcessando(true);
    setErro(null);
    try {
      await acao(selecionada.id);
      setSelecionada(null);
      setRecarga((valor) => valor + 1);
    } catch {
      setErro('Não foi possível concluir a operação. Nenhuma alteração foi registrada.');
    } finally {
      setProcessando(false);
    }
  }

  if (carregando) {
    return <AReceberSkeleton />;
  }

  if (!dados) {
    return (
      <EstadoVazioCompartilhado
        icone={WarningCircle}
        titulo="Não foi possível carregar as contas a receber"
        descricao={erroCarregamento ?? 'Tente novamente para consultar os recebíveis da unidade.'}
        acao={<Botao variante="secundario" onClick={() => setRecarga((valor) => valor + 1)}>Tentar novamente</Botao>}
      />
    );
  }

  const selectClasses =
    'h-8 rounded-md border border-line bg-surface px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';
  const vazio = entradasFiltradas.length === 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho com total */}
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[length:var(--fs-15)] font-semibold">
          A receber
        </h2>
        <span className="num text-lg font-semibold tabular-nums">
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4">
        <Campo
          rotulo="Buscar paciente"
          placeholder="Nome ou descrição"
          denso
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          className="min-w-[220px] flex-1"
        />
        <div className="flex items-end gap-2">
          <Campo
            rotulo="De"
            type="date"
            denso
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-36"
          />
          <Campo
            rotulo="Até"
            type="date"
            denso
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-36"
          />
        </div>

        {categoriasDisponiveis.length > 0 && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${baseId}-categoria`}
              className="text-sm font-medium text-text-muted"
            >
              Categoria
            </label>
            <select
              id={`${baseId}-categoria`}
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
              className={selectClasses}
            >
              <option value="">Todas</option>
              {categoriasDisponiveis.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${baseId}-status`}
            className="text-sm font-medium text-text-muted"
          >
            Status
          </label>
          <select
            id={`${baseId}-status`}
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className={selectClasses}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="vencido">Vencido</option>
            <option value="pago">Pago</option>
          </select>
        </div>
      </div>

      {/* Tabela ou estado vazio */}
      {vazio ? (
        <EstadoVazioDaTabela />
      ) : (
        <section aria-label="Lançamentos a receber">
          <div className="rounded-lg border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <ThSortavel
                      campo="data"
                      rotulo="Data"
                      ordenacao={ordenacao}
                      onSort={setOrdenacao}
                    />
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                      Descrição
                    </th>
                    <ThSortavel
                      campo="valor"
                      rotulo="Valor"
                      ordenacao={ordenacao}
                      onSort={setOrdenacao}
                      className="text-right"
                    />
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-text-muted">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {entradasFiltradas.map((e) => {
                    const status = derivarStatus(e);
                    const aging = calcularAging(e.daysPastDue);
                    return (
                      <tr
                        key={e.id}
                        data-aging={aging}
                        className={cn(
                          'cursor-pointer hover:bg-surface-hover transition-colors-fast focus-within:bg-surface-subtle',
                          status === 'vencido' && 'bg-danger-soft/20',
                        )}
                        tabIndex={0}
                        onClick={() => setSelecionada(e)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelecionada(e); } }}
                      >
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">
                          {formatarData(e.dueDate)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-text">
                            {e.patientName}
                          </div>
                          <div className="text-xs text-text-muted">
                            {e.description}
                            {e.daysPastDue > 0 &&
                              ` (${e.daysPastDue}d atraso)`}
                          </div>
                        </td>
                        <td
                          className={cn(
                            'px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums font-medium',
                            e.amountCents >= 0 ? 'text-ok' : 'text-danger',
                          )}
                        >
                          {centavosParaReais(e.amountCents)}
                        </td>
                        <td className="px-4 py-3">
                          <ChipDeStatusFinanceiro status={status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Botao
                              variante="secundario"
                              tamanho="sm"
                              onClick={(event) => { event.stopPropagation(); setSelecionada(e); }}
                            >
                              Ver detalhes
                            </Botao>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <PainelLateral
        aberto={selecionada !== null}
        onFechar={() => { setSelecionada(null); setErro(null); }}
        titulo="Título a receber"
        descricao={selecionada ? `${selecionada.patientName} · ${selecionada.description}` : 'Detalhes do recebível'}
        largura="md"
        rodape={selecionada ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Botao variante="secundario" carregando={processando} onClick={() => { void executar(p.aoEnviarLink); }}>Enviar cobrança</Botao>
            <Botao carregando={processando} onClick={() => { void executar(p.aoMarcarPago); }}>Registrar pagamento</Botao>
          </div>
        ) : undefined}
      >
        {selecionada ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <div className="col-span-2"><dt className="text-xs text-text-faint">Paciente</dt><dd className="mt-1 font-semibold text-text">{selecionada.patientName}</dd></div>
              <div><dt className="text-xs text-text-faint">Vencimento</dt><dd className="mt-1 font-medium text-text tabular-nums">{formatarData(selecionada.dueDate)}</dd></div>
              <div><dt className="text-xs text-text-faint">Valor</dt><dd className="mt-1 font-semibold text-text tabular-nums">{centavosParaReais(selecionada.amountCents)}</dd></div>
              <div><dt className="text-xs text-text-faint">Situação</dt><dd className="mt-1"><ChipDeStatusFinanceiro status={derivarStatus(selecionada)} /></dd></div>
              <div><dt className="text-xs text-text-faint">Atraso</dt><dd className="mt-1 font-medium text-text">{selecionada.daysPastDue > 0 ? `${selecionada.daysPastDue} dias` : 'Dentro do prazo'}</dd></div>
            </dl>
            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-text">Descrição</h3>
              <p className="mt-2 text-sm text-text-muted">{selecionada.description}</p>
              {selecionada.categoryName ? <p className="mt-1 text-xs text-text-faint">Categoria: {selecionada.categoryName}</p> : null}
            </section>
            {erro ? <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{erro}</p> : null}
            <Botao variante="fantasma" fullWidth onClick={() => { void executar(p.aoCobrar); }}>Gerar novo link de cobrança</Botao>
          </div>
        ) : null}
      </PainelLateral>
    </div>
  );
}
