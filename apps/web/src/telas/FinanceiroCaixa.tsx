// apps/web/src/telas/FinanceiroCaixa.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

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

function formatarHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(d);
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroCaixa(p: FinanceiroCaixaProps) {
  const [dados, setDados] = useState<CaixaDados | null>(null);
  const [contaId, setContaId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      contaId: contaId === '' ? undefined : contaId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-conta" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Conta
          </label>
          <select
            id="filtro-conta"
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            aria-label="Conta"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        <Campo rotulo="Data inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data inicio" />
        <Campo rotulo="Data fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Totais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 'var(--s-4)' }}>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Receita</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums',
                                      color: 'var(--ok)' }}>
            {centavosParaReais(dados.totalReceita)}
          </p>
        </div>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Despesa</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums',
                                      color: 'var(--danger)' }}>
            {centavosParaReais(dados.totalDespesa)}
          </p>
        </div>
        <div style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                      background: 'var(--surface)', padding: 'var(--s-5)' }}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>Saldo</span>
          <p className="num" style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                                      margin: 'var(--s-1) 0 0', fontVariantNumeric: 'tabular-nums' }}>
            {centavosParaReais(dados.saldo)}
          </p>
        </div>
      </div>

      {/* Extrato */}
      <section aria-label="Extrato">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.lancamentos.map((l) => {
            const sinal = l.kind === 'receita' ? '+' : '-';
            const cor = l.kind === 'receita' ? 'var(--ok)' : 'var(--danger)';
            return (
              <li key={l.id} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                               fontVariantNumeric: 'tabular-nums', minWidth: '4ch' }}>
                  {formatarHora(l.paidAt)}
                </span>
                <div>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {l.descricao}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {l.categoryName} — {l.method}
                  </span>
                </div>
                <span className="num" style={{
                  fontSize: 'var(--fs-14)', fontVariantNumeric: 'tabular-nums',
                  fontWeight: 'var(--fw-medium)', color: cor,
                }}>
                  {sinal} {centavosParaReais(l.amountCents)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
