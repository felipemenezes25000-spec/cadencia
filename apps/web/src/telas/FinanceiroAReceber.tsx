// apps/web/src/telas/FinanceiroAReceber.tsx
'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { SortAscending, SortDescending, Receipt } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

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

// ── Ordenacao ──────────────────────────────────────────────────────────────

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
  { readonly rotulo: string; readonly classes: string }
> = {
  pendente: { rotulo: 'Pendente', classes: 'bg-warn-soft text-warn' },
  vencido: { rotulo: 'Vencido', classes: 'bg-danger-soft text-danger' },
  pago: { rotulo: 'Pago', classes: 'bg-ok-soft text-ok' },
};

function ChipDeStatusFinanceiro({ status }: { readonly status: StatusFinanceiro }) {
  const c = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        c.classes,
      )}
    >
      {c.rotulo}
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
      <div className="overflow-hidden rounded-[18px] border border-line/75 bg-surface/94 shadow-elev-1">
        <div className="border-b border-line/70/70 bg-surface-sunken/45 px-4 py-2.5">
          <Skeleton variant="text" width="80%" height="16px" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-line/70 px-4 py-3">
            <Skeleton variant="table-row" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Estado vazio ──────────────────────────────────────────────────────────

function EstadoVazio() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icone icon={Receipt} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhum lancamento encontrado
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Ajuste os filtros ou adicione um novo lancamento
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAReceber(p: FinanceiroAReceberProps) {
  const baseId = useId();
  const [dados, setDados] = useState<AReceberDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(null);

  useEffect(() => {
    setCarregando(true);
    void p.carregarDados().then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }, [p]);

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
  }, [dados, dataInicio, dataFim, categoriaFiltro, statusFiltro, ordenacao]);

  if (carregando) {
    return <AReceberSkeleton />;
  }

  if (!dados) return null;

  const selectClasses =
    'h-8 rounded-[16px] border border-line/75 bg-surface/94 shadow-elev-1 px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';
  const vazio = entradasFiltradas.length === 0;

  return (
    <div className="space-y-6">
      {/* Cabecalho com total */}
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
            rotulo="Ate"
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
        <EstadoVazio />
      ) : (
        <section aria-label="Lancamentos a receber">
          <div className="overflow-hidden rounded-[18px] border border-line/75 bg-surface/94 shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line/70/70 bg-surface-sunken/45">
                    <ThSortavel
                      campo="data"
                      rotulo="Data"
                      ordenacao={ordenacao}
                      onSort={setOrdenacao}
                    />
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                      Descricao
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
                      Acoes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/65">
                  {entradasFiltradas.map((e) => {
                    const status = derivarStatus(e);
                    const aging = calcularAging(e.daysPastDue);
                    return (
                      <tr
                        key={e.id}
                        data-aging={aging}
                        className={cn(
                          'hover:bg-surface-hover transition-colors-fast',
                          status === 'vencido' && 'bg-danger-soft',
                        )}
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
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => {
                                void p.aoCobrar(e.id);
                              }}
                            >
                              Cobrar
                            </Botao>
                            <Botao
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => {
                                void p.aoMarcarPago(e.id);
                              }}
                            >
                              Marcar pago
                            </Botao>
                            <Botao
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => {
                                void p.aoEnviarLink(e.id);
                              }}
                            >
                              Enviar link
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
    </div>
  );
}
