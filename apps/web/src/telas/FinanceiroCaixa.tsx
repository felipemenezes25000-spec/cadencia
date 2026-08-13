// apps/web/src/telas/FinanceiroCaixa.tsx
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

export interface LancamentoCaixa {
  readonly id: string;
  readonly descricao: string;
  readonly amountCents: number;
  readonly kind: 'receita' | 'despesa';
  readonly method: string;
  readonly paidAt: string;
  readonly categoryName: string;
}

export interface ContaBancaria {
  readonly id: string;
  readonly nome: string;
}

export interface CaixaDados {
  readonly lancamentos: readonly LancamentoCaixa[];
  readonly totalReceita: number;
  readonly totalDespesa: number;
  readonly saldo: number;
  readonly contas: readonly ContaBancaria[];
}

export interface FiltrosCaixa {
  readonly contaId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface FinanceiroCaixaProps {
  readonly carregarDados: (filtros: FiltrosCaixa) => Promise<CaixaDados>;
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

// ── Chip de tipo ──────────────────────────────────────────────────────────

function ChipDeTipo({ tipo }: { readonly tipo: 'receita' | 'despesa' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tipo === 'receita' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
      )}
    >
      {tipo === 'receita' ? 'Receita' : 'Despesa'}
    </span>
  );
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function CaixaSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton variant="text" width="120px" height="32px" />
        <Skeleton variant="text" width="120px" height="32px" />
        <Skeleton variant="text" width="120px" height="32px" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <Skeleton variant="card" height="80px" />
        <Skeleton variant="card" height="80px" />
        <Skeleton variant="card" height="80px" />
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

export function FinanceiroCaixa(p: FinanceiroCaixaProps) {
  const baseId = useId();
  const [dados, setDados] = useState<CaixaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [contaId, setContaId] = useEstadoNaUrl('conta');
  const [dataInicio, setDataInicio] = useEstadoNaUrl('inicio');
  const [dataFim, setDataFim] = useEstadoNaUrl('fim');
  const [categoriaFiltro, setCategoriaFiltro] = useEstadoNaUrl('categoria');
  const [tipoFiltro, setTipoFiltro] = useEstadoNaUrl('tipo');
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
        ...(contaId !== '' ? { contaId } : {}),
        ...(dataInicio !== '' ? { dataInicio } : {}),
        ...(dataFim !== '' ? { dataFim } : {}),
      })
      .then((d) => {
        setDados(d);
        setCarregando(false);
      });
  }

  const categoriasDisponiveis = useMemo(() => {
    if (!dados) return [];
    const cats = new Set(dados.lancamentos.map((l) => l.categoryName));
    return Array.from(cats).sort();
  }, [dados]);

  const lancamentosFiltrados = useMemo(() => {
    if (!dados) return [];
    let resultado = [...dados.lancamentos];

    if (categoriaFiltro !== '') {
      resultado = resultado.filter((l) => l.categoryName === categoriaFiltro);
    }

    if (tipoFiltro !== '') {
      resultado = resultado.filter((l) => l.kind === tipoFiltro);
    }

    if (ordenacao) {
      resultado.sort((a, b) => {
        let cmp = 0;
        switch (ordenacao.campo) {
          case 'data':
            cmp = a.paidAt.localeCompare(b.paidAt);
            break;
          case 'categoria':
            cmp = a.categoryName.localeCompare(b.categoryName);
            break;
          case 'valor': {
            const va = a.kind === 'receita' ? a.amountCents : -a.amountCents;
            const vb = b.kind === 'receita' ? b.amountCents : -b.amountCents;
            cmp = va - vb;
            break;
          }
          default:
            cmp = 0;
        }
        return ordenacao.direcao === 'desc' ? -cmp : cmp;
      });
    }

    return resultado;
  }, [dados, categoriaFiltro, tipoFiltro, ordenacao]);

  if (carregando) {
    return <CaixaSkeleton />;
  }

  if (!dados) return null;

  const selectClasses =
    'h-8 rounded-md border border-line bg-surface px-3 text-sm text-text transition-colors-fast focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';
  const vazio = lancamentosFiltrados.length === 0;

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${baseId}-conta`}
            className="text-sm font-medium text-text-muted"
          >
            Conta
          </label>
          <select
            id={`${baseId}-conta`}
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            className={selectClasses}
          >
            <option value="">Todas</option>
            {dados.contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
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

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${baseId}-tipo`}
            className="text-sm font-medium text-text-muted"
          >
            Tipo
          </label>
          <select
            id={`${baseId}-tipo`}
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value)}
            className={selectClasses}
          >
            <option value="">Todos</option>
            <option value="receita">Receita</option>
            <option value="despesa">Despesa</option>
          </select>
        </div>

        <Botao variante="secundario" tamanho="sm" onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Receita
          </span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ok">
            {centavosParaReais(dados.totalReceita)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Despesa
          </span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-danger">
            {centavosParaReais(dados.totalDespesa)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Saldo
          </span>
          <p className="num mt-1 text-lg font-semibold tabular-nums">
            {centavosParaReais(dados.saldo)}
          </p>
        </div>
      </div>

      {/* Tabela ou estado vazio */}
      {vazio ? (
        <EstadoVazio />
      ) : (
        <section aria-label="Extrato">
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
                      Tipo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {lancamentosFiltrados.map((l) => {
                    const positivo = l.kind === 'receita';
                    const valorExibido = `${positivo ? '+' : '-'} ${centavosParaReais(l.amountCents)}`;
                    return (
                      <tr
                        key={l.id}
                        className="hover:bg-surface-hover transition-colors-fast"
                      >
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">
                          {formatarData(l.paidAt)}
                        </td>
                        <td className="px-4 py-3 text-text">
                          <div>{l.descricao}</div>
                          <div className="text-xs text-text-muted">{l.method}</div>
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {l.categoryName}
                        </td>
                        <td
                          className={cn(
                            'px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums font-medium',
                            positivo ? 'text-ok' : 'text-danger',
                          )}
                        >
                          {valorExibido}
                        </td>
                        <td className="px-4 py-3">
                          <ChipDeTipo tipo={l.kind} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-surface-raised">
                    <td
                      colSpan={3}
                      className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
                    >
                      Saldo do período
                    </td>
                    <td className="num px-4 py-3 text-right font-mono tabular-nums font-semibold">
                      {centavosParaReais(dados.saldo)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
