// apps/web/src/telas/FinanceiroAPagar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface DespesaPendente {
  readonly id: string;
  readonly descricao: string;
  readonly fornecedor: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly categoryName: string;
  readonly status: 'pendente';
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
  readonly aoEditar: (despesaId: string) => void;
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

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAPagar(p: FinanceiroAPagarProps) {
  const [dados, setDados] = useState<APagarDados | null>(null);
  const [fornecedor, setFornecedor] = useState('');
  const [categoria, setCategoria] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      fornecedor: fornecedor === '' ? undefined : fornecedor,
      categoria: categoria === '' ? undefined : categoria,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Campo rotulo="Fornecedor" denso
          value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
          aria-label="Fornecedor" placeholder="Nome do fornecedor" />

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-categoria-ap" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Categoria
          </label>
          <select
            id="filtro-categoria-ap"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            aria-label="Categoria"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.categorias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <Campo rotulo="Vencimento inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Vencimento inicio" />
        <Campo rotulo="Vencimento fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Vencimento fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          A pagar
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Lista */}
      <section aria-label="Despesas a pagar">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.despesas.map((d) => (
            <li key={d.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 44,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {d.descricao}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {d.fornecedor} — {d.categoryName} — vence {d.dueDate}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <span className="num" style={{ fontSize: 'var(--fs-14)',
                                                fontVariantNumeric: 'tabular-nums',
                                                marginInlineEnd: 'var(--s-3)' }}>
                  {centavosParaReais(d.amountCents)}
                </span>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoMarcarPago(d.id); }}>
                  Marcar pago
                </Botao>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { p.aoEditar(d.id); }}>
                  Editar
                </Botao>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoParcelar(d.id); }}>
                  Parcelar
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
