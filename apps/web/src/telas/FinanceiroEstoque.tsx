// apps/web/src/telas/FinanceiroEstoque.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ProdutoEstoque {
  readonly id: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly minimo: number;
  readonly unidade: string;
  readonly ultimaMovimentacao: string;
  readonly alertaBaixo: boolean;
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

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroEstoque(p: FinanceiroEstoqueProps) {
  const [dados, setDados] = useState<EstoqueDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)' }}>
      {/* Cabecalho com acao */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Estoque
        </h2>
        <Botao variante="secundario" altura={32}
          onClick={() => { void p.aoRegistrarMovimentacao(); }}>
          Nova movimentacao
        </Botao>
      </div>

      {/* Lista de produtos */}
      <section aria-label="Produtos em estoque">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.produtos.map((pr) => (
            <li key={pr.id}
              data-alerta={pr.alertaBaixo ? 'baixo' : 'ok'}
              style={{
                display: 'grid', gridTemplateColumns: '4px 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                paddingInlineStart: 0,
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
              {/* Barra lateral de alerta */}
              <span style={{
                display: 'block', width: 4, alignSelf: 'stretch',
                background: pr.alertaBaixo ? 'var(--danger)' : 'var(--ok)',
                borderRadius: 'var(--r-sm)',
              }} aria-hidden="true" />

              <div style={{ paddingInlineStart: 'var(--s-3)' }}>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {pr.nome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  Minimo: {pr.minimo} {pr.unidade} — Ultima mov.: {pr.ultimaMovimentacao}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <span className="num" style={{
                  fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                  fontVariantNumeric: 'tabular-nums',
                  color: pr.alertaBaixo ? 'var(--danger)' : 'var(--text)',
                }}>
                  {pr.quantidade} {pr.unidade}
                </span>
                {pr.alertaBaixo ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                    fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                    fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                    borderRadius: 'var(--r-full)',
                    color: 'var(--danger)', background: 'var(--danger-soft)',
                  }}>
                    <span aria-hidden="true">!</span>Baixo
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Historico de movimentacoes */}
      <section aria-label="Movimentacoes recentes">
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Movimentacoes recentes
        </h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.movimentacoes.map((m) => (
            <li key={m.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 44,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {m.produtoNome} — {m.data}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {m.responsavel}
                </span>
              </div>
              <span className="num" style={{
                fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                fontVariantNumeric: 'tabular-nums',
                color: m.tipo === 'entrada' ? 'var(--ok)' : 'var(--danger)',
              }}>
                {m.tipo === 'entrada' ? '+' : '-'}{m.quantidade} — {m.tipo}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
