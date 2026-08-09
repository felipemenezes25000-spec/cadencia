// apps/web/src/telas/FinanceiroEstoque.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, Warning, Package } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ProdutoEstoque {
  readonly id: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly minimo: number;
  readonly unidade: string;
  readonly ultimaMovimentacao: string;
  readonly alertaBaixo: boolean;
  readonly categoria?: string;
}

export interface MovimentacaoEstoque {
  readonly id: string;
  readonly produtoNome: string;
  readonly tipo: 'entrada' | 'saida';
  readonly quantidade: number;
  readonly data: string;
  readonly responsavel: string;
}

export interface EstoqueDados {
  readonly produtos: readonly ProdutoEstoque[];
  readonly movimentacoes: readonly MovimentacaoEstoque[];
}

export interface FinanceiroEstoqueProps {
  readonly carregarDados: () => Promise<EstoqueDados>;
  readonly aoRegistrarMovimentacao: () => Promise<void>;
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function EstoqueSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando estoque...">
      {/* Cabecalho skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton variant="text" width="80px" height="24px" />
        <Skeleton variant="text" width="140px" height="32px" />
      </div>
      {/* Filtros skeleton */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton variant="text" width="200px" height="36px" />
        <Skeleton variant="text" width="120px" height="36px" />
        <Skeleton variant="text" width="150px" height="20px" />
      </div>
      {/* Tabela skeleton */}
      <div className="rounded-lg border border-line overflow-hidden">
        <div className="border-b border-line bg-surface-raised px-4 py-2.5">
          <Skeleton variant="text" width="80%" height="16px" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
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
      <Icone icon={Package} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhum produto encontrado
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Ajuste os filtros ou cadastre novos produtos
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroEstoque(p: FinanceiroEstoqueProps) {
  const [dados, setDados] = useState<EstoqueDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [apenasEstoqueBaixo, setApenasEstoqueBaixo] = useState(false);

  useEffect(() => {
    setCarregando(true);
    void p.carregarDados().then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }, [p]);

  // Categorias unicas para o filtro
  const categorias = useMemo(() => {
    if (!dados) return [];
    const cats = new Set(
      dados.produtos.map((pr) => pr.categoria).filter((c): c is string => c != null && c !== ''),
    );
    return Array.from(cats).sort();
  }, [dados]);

  // Produtos filtrados
  const produtosFiltrados = useMemo(() => {
    if (!dados) return [];
    let resultado = [...dados.produtos];

    if (busca.trim() !== '') {
      const termo = busca.trim().toLowerCase();
      resultado = resultado.filter((pr) => pr.nome.toLowerCase().includes(termo));
    }

    if (categoriaFiltro !== '') {
      resultado = resultado.filter((pr) => pr.categoria === categoriaFiltro);
    }

    if (apenasEstoqueBaixo) {
      resultado = resultado.filter((pr) => pr.alertaBaixo);
    }

    return resultado;
  }, [dados, busca, categoriaFiltro, apenasEstoqueBaixo]);

  if (carregando) {
    return <EstoqueSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Cabecalho com acao */}
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--fs-15)] font-semibold text-text">
          Estoque
        </h2>
        <Botao
          variante="secundario"
          tamanho="md"
          onClick={() => { void p.aoRegistrarMovimentacao(); }}
        >
          Nova movimentacao
        </Botao>
      </div>

      {/* Busca e filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar produto..."
          className="max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar produto"
        />
        {categorias.length > 0 && (
          <select
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
            aria-label="Filtrar por categoria"
            className={cn(
              'h-9 rounded-md border border-line bg-surface px-3 text-sm text-text',
              'transition-colors duration-[var(--dur-2)]',
              'focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none',
            )}
          >
            <option value="">Todas categorias</option>
            {categorias.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="accent-accent"
            checked={apenasEstoqueBaixo}
            onChange={(e) => setApenasEstoqueBaixo(e.target.checked)}
          />
          Apenas estoque baixo
        </label>
      </div>

      {/* Tabela de produtos */}
      {produtosFiltrados.length === 0 ? (
        <EstadoVazio />
      ) : (
        <section aria-label="Produtos em estoque">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised">
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Produto
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Categoria
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                    Quantidade
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                    Minimo
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {produtosFiltrados.map((pr) => (
                  <tr
                    key={pr.id}
                    data-alerta={pr.alertaBaixo ? 'baixo' : 'ok'}
                    className={cn(
                      'transition-colors duration-[var(--dur-2)] hover:bg-surface-raised',
                      pr.alertaBaixo && 'bg-danger-soft/30',
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-text">{pr.nome}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {pr.categoria ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text">
                      {pr.quantidade} {pr.unidade}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {pr.minimo} {pr.unidade}
                    </td>
                    <td className="px-4 py-3">
                      {pr.alertaBaixo ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                          <Icone icon={Warning} size="sm" />
                          Estoque baixo
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-ok">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Movimentacoes recentes */}
      {dados && dados.movimentacoes.length > 0 && (
        <section aria-label="Movimentacoes recentes">
          <h3 className="mb-3 text-[length:var(--fs-15)] font-semibold text-text">
            Movimentacoes recentes
          </h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised">
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Produto
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                    Responsavel
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                    Quantidade
                  </th>
                  <th className="px-4 py-2.5 text-center font-medium text-text-muted">
                    Tipo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dados.movimentacoes.map((m) => (
                  <tr
                    key={m.id}
                    className="transition-colors duration-[var(--dur-2)] hover:bg-surface-raised"
                  >
                    <td className="px-4 py-3 font-medium text-text">{m.produtoNome}</td>
                    <td className="px-4 py-3 text-text-muted">{m.data}</td>
                    <td className="px-4 py-3 text-text-muted">{m.responsavel}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={cn(
                        'font-medium',
                        m.tipo === 'entrada' ? 'text-ok' : 'text-danger',
                      )}>
                        {m.tipo === 'entrada' ? '+' : '-'}{m.quantidade}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        m.tipo === 'entrada'
                          ? 'bg-ok-soft text-ok'
                          : 'bg-danger-soft text-danger',
                      )}>
                        {m.tipo === 'entrada' ? 'Entrada' : 'Saida'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
