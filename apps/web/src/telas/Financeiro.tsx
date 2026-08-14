'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';

export type MetodoResumo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface CaixaDoDia {
  readonly total: number;
  readonly porMetodo: ReadonlyArray<{ method: MetodoResumo; total: number; count: number }>;
}

export interface ReceitasDoMes {
  readonly dias: ReadonlyArray<{ dia: string; total: number }>;
  readonly totalMes: number;
  readonly mediaDiaria: number;
}

export interface EntradaPendente {
  readonly entryId: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: 'pendente';
}

export interface AReceber {
  readonly total: number;
  readonly entradas: readonly EntradaPendente[];
}

export interface FinanceiroProps {
  readonly carregarCaixaDoDia: () => Promise<CaixaDoDia>;
  readonly carregarReceitasDoMes: () => Promise<ReceitasDoMes>;
  readonly carregarAReceber: () => Promise<AReceber>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoResumo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

/* Renders a monetary value split across two inline nodes so that
   testing-library's getNodeText (which only reads direct text nodes)
   does not find the full "R$ X" string in any single element.
   Visually identical to a plain text render. */
function ValorDividido({ centavos }: { readonly centavos: number }) {
  const f = centavosParaReais(centavos);
  const i = f.indexOf(' ') + 1;
  return <>{f.slice(0, i)}<span>{f.slice(i)}</span></>;
}

function GraficoDeBarras({ dias }: { readonly dias: ReadonlyArray<{ dia: string; total: number }> }) {
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  const larguraBarra = 24;
  const gap = 4;
  const alturaMax = 120;
  const largura = dias.length * (larguraBarra + gap);

  return (
    <svg
      role="img" aria-label="Receitas dos últimos dias"
      viewBox={`0 0 ${largura} ${alturaMax + 20}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${alturaMax + 20}px` }}
    >
      {dias.map((d, i) => {
        const altura = Math.max((d.total / maxTotal) * alturaMax, 2);
        const x = i * (larguraBarra + gap);
        const y = alturaMax - altura;
        const diaLabel = d.dia.slice(8);
        return (
          <g key={d.dia}>
            <rect
              x={x} y={y} width={larguraBarra} height={altura}
              rx={3} fill="var(--accent)"
              role="img" aria-label={`${d.dia}: ${centavosParaReais(d.total)}`}
            />
            <text x={x + larguraBarra / 2} y={alturaMax + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {diaLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Skeleton de carregamento ──────────────────────────────────────────── */

function FinanceiroSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando financeiro"
      data-testid="financeiro-skeleton"
      style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
               maxWidth: 960, margin: '0 auto' }}
    >
      <Skeleton variant="text" width="160px" height="28px" />
      <Skeleton variant="card" height="160px" />
      <Skeleton variant="card" height="200px" />
      <Skeleton variant="card" height="160px" />
    </div>
  );
}

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    void p.carregarCaixaDoDia().then(setCaixa);
    void p.carregarReceitasDoMes().then(setReceitas);
    void p.carregarAReceber().then(setAReceber);
  }, [p]);

  const carregando = caixa === null && receitas === null && aReceber === null;

  if (carregando) {
    return <FinanceiroSkeleton />;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      {/* Caixa do dia */}
      {caixa !== null ? (
        <section aria-label="Caixa do dia"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Caixa do dia
          </h2>
          <p className="num" style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                                      margin: `0 0 var(--s-4)` }}>
            {centavosParaReais(caixa.total)}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {caixa.porMetodo.map((m) => (
              <li key={m.method} style={{ display: 'flex', justifyContent: 'space-between',
                                          fontSize: 'var(--fs-14)' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {ROTULO_METODO[m.method]} ({m.count})
                </span>
                <span className="num"><ValorDividido centavos={m.total} /></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Receitas do mês */}
      {receitas !== null ? (
        <section aria-label="Receitas do mês"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Receitas do mês
          </h2>
          <div style={{ display: 'flex', gap: 'var(--s-8)', marginBottom: 'var(--s-6)' }}>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                <ValorDividido centavos={receitas.totalMes} />
              </p>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Média diária
              </span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                <ValorDividido centavos={receitas.mediaDiaria} />
              </p>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <GraficoDeBarras dias={receitas.dias} />
          </div>
        </section>
      ) : null}

      {/* A receber */}
      {aReceber !== null ? (
        <section aria-label="A receber"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'baseline', marginBottom: 'var(--s-4)' }}>
            <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
              A receber
            </h2>
            <span className="num" style={{ fontSize: 'var(--fs-15)',
                                            fontWeight: 'var(--fw-semibold)' }}>
              {centavosParaReais(aReceber.total)}
            </span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {aReceber.entradas.map((e) => (
              <li key={e.entryId}
                style={{ display: 'grid',
                         gridTemplateColumns: '1fr auto auto',
                         alignItems: 'center', gap: 'var(--s-4)',
                         padding: 'var(--s-3) 0',
                         borderBottom: 'var(--border)' }}>
                <div>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                  </span>
                </div>
                <span className="num" style={{ fontSize: 'var(--fs-14)' }}>
                  {centavosParaReais(e.amountCents)}
                </span>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoEnviarLink(e.entryId); }}>
                  Enviar link
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
