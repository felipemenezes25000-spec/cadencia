// apps/web/src/telas/FinanceiroAPagar.tsx
'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import { SortAscending, SortDescending, Receipt } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusFinanceiro = 'pendente' | 'vencido' | 'pago';

export interface DespesaPendente {
  readonly id: string;
  readonly descricao: string;
  readonly fornecedor: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly categoryName: string;
  readonly status: StatusFinanceiro;
}

export interface APagarDados {
  readonly total: number;
  readonly despesas: readonly DespesaPendente[];
  readonly categorias: readonly string[];
}

export interface FiltrosAPagar {
  readonly fornecedor?: string;
  readonly categoria?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface FinanceiroAPagarProps {
  readonly carregarDados: (filtros: FiltrosAPagar) => Promise<APagarDados>;
  readonly aoMarcarPago: (despesaId: string) => Promise<void>;
  readonly aoParcelar: (despesaId: string) => Promise<void>;
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

function APagarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton variant="text" width="120px" height="32px" />
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

function EstadoVazio() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icone icon={Receipt} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhum lançamento encontrado
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Ajuste os filtros ou adicione um novo lançamento
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAPagar(p: FinanceiroAPagarProps) {
  const baseId = useId();
  const [dados, setDados] = useState<APagarDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [fornecedor, setFornecedor] = useEstadoNaUrl('fornecedor');
  const [categoria, setCategoria] = useEstadoNaUrl('categoria');
  const [dataInicio, setDataInicio] = useEstadoNaUrl('inicio');
  const [dataFim, setDataFim] = useEstadoNaUrl('fim');
  const [statusFiltro, setStatusFiltro] = useEstadoNaUrl('status');
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(null);

  useEffect(() => {
    setCarregando(true);
    void p.carregarDados({}).then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }, [p]);

  function filtrar(): void {
    setCarregando(true);
    void p
      .carregarDados({
        ...(fornecedor !== '' ? { fornecedor } : {}),
        ...(categoria !== '' ? { categoria } : {}),
        ...(dataInicio !== '' ? { dataInicio } : {}),
        ...(dataFim !== '' ? { dataFim } : {}),
      })
      .then((d) => {
        setDados(d);
        setCarregando(false);
      });
  }

  const despesasFiltradas = useMemo(() => {
    if (!dados) return [];
    let resultado = [...dados.despesas];

    // Status filter (client-side, since FiltrosAPagar has no status)
    if (statusFiltro !== '') {
      resultado = resultado.filter((d) => d.status === statusFiltro);
    }

    // Sort
    if (ordenacao) {
      resultado.sort((a, b) => {
        let cmp = 0;
        switch (ordenacao.campo) {
          case 'data':
            cmp = a.dueDate.localeCompare(b.dueDate);
            break;
          case 'categoria':
            cmp = a.categoryName.localeCompare(b.categoryName);
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
  }, [dados, statusFiltro, ordenacao]);

  if (carregando) {
    return <APagarSkeleton />;
  }

  if (!dados) return null;

  const selectClasses =
    'h-8 rounded-md border border-line bg-surface px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';
  const vazio = despesasFiltradas.length === 0;

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4">
        <Campo
          rotulo="Fornecedor"
          denso
          value={fornecedor}
          onChange={(e) => setFornecedor(e.target.value)}
          placeholder="Nome do fornecedor"
          className="w-48"
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${baseId}-categoria`}
            className="text-sm font-medium text-text-muted"
          >
            Categoria
          </label>
          <select
            id={`${baseId}-categoria`}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className={selectClasses}
          >
            <option value="">Todas</option>
            {dados.categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

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

        <Botao variante="secundario" tamanho="sm" onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[length:var(--fs-15)] font-semibold">
          A pagar
        </h2>
        <span className="num text-lg font-semibold tabular-nums">
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Tabela ou estado vazio */}
      {vazio ? (
        <EstadoVazio />
      ) : (
        <section aria-label="Despesas a pagar">
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
                      campo="categoria"
                      rotulo="Categoria"
                      ordenacao={ordenacao}
                      onSort={setOrdenacao}
                    />
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
                  {despesasFiltradas.map((d) => (
                    <tr
                      key={d.id}
                      className={cn(
                        'hover:bg-surface-hover transition-colors-fast',
                        d.status === 'vencido' && 'bg-danger-soft',
                      )}
                    >
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">
                        {formatarData(d.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text">{d.descricao}</div>
                        <div className="text-xs text-text-muted">
                          {d.fornecedor}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {d.categoryName}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums font-medium',
                          d.amountCents >= 0 ? 'text-ok' : 'text-danger',
                        )}
                      >
                        {centavosParaReais(d.amountCents)}
                      </td>
                      <td className="px-4 py-3">
                        <ChipDeStatusFinanceiro status={d.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => {
                              void p.aoMarcarPago(d.id);
                            }}
                          >
                            Marcar pago
                          </Botao>
                          {/* Havia aqui um botao "Editar" ligado a uma funcao
                              vazia. Nao existe rota de alteracao de despesa —
                              `finance-operations.ts` expoe `POST /v1/payables`
                              para criar e `POST /v1/payables/:id/pagar` para
                              baixar, nada que edite. Clicar nao fazia nada. O
                              botao volta quando a rota existir. */}
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => {
                              void p.aoParcelar(d.id);
                            }}
                          >
                            Parcelar
                          </Botao>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
