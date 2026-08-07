// apps/web/src/telas/FinanceiroVisao.tsx
'use client';

import { useEffect, useState } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ReceitaVsDespesaItem {
  readonly mes: string;
  readonly receita: number;
  readonly despesa: number;
}

export interface SaldoProjetadoItem {
  readonly dia: string;
  readonly saldo: number;
}

export interface CategoriaItem {
  readonly nome: string;
  readonly total: number;
  readonly percentual: number;
}

export interface AlertaItem {
  readonly tipo: string;
  readonly mensagem: string;
  readonly severidade: 'danger' | 'warn' | 'ok';
}

export interface ResumoMes {
  readonly receitaTotal: number;
  readonly despesaTotal: number;
  readonly saldo: number;
}

export interface VisaoDados {
  readonly receitaVsDespesa: readonly ReceitaVsDespesaItem[];
  readonly saldoProjetado: readonly SaldoProjetadoItem[];
  readonly topCategorias: readonly CategoriaItem[];
  readonly alertas: readonly AlertaItem[];
  readonly resumoMes: ResumoMes;
}

export interface FinanceiroVisaoProps {
  readonly dados?: never;
  readonly carregarDados: () => Promise<VisaoDados>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const TOKEN_SEVERIDADE: Record<string, string> = {
  danger: '--danger',
  warn: '--warn',
  ok: '--ok',
};

const BG_SEVERIDADE: Record<string, string> = {
  danger: '--danger-soft',
  warn: '--warn-soft',
  ok: '--ok-soft',
};

const GLIFO_SEVERIDADE: Record<string, string> = {
  danger: '!',
  warn: '!',
  ok: '✓',
};

// ── Grafico Receita vs Despesa (SVG puro) ──────────────────────────────────

function GraficoReceitaDespesa({ dados }: { readonly dados: readonly ReceitaVsDespesaItem[] }) {
  const maxVal = Math.max(...dados.flatMap((d) => [d.receita, d.despesa]), 1);
  const barW = 20;
  const gap = 6;
  const groupW = barW * 2 + gap;
  const groupGap = 16;
  const alturaMax = 120;
  const largura = dados.length * (groupW + groupGap);

  return (
    <svg
      role="img" aria-label="Receita vs despesa"
      viewBox={`0 0 ${largura} ${alturaMax + 30}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${alturaMax + 30}px` }}
    >
      {dados.map((d, i) => {
        const x = i * (groupW + groupGap);
        const hRec = Math.max((d.receita / maxVal) * alturaMax, 2);
        const hDesp = Math.max((d.despesa / maxVal) * alturaMax, 2);
        const mesLabel = d.mes.slice(5);
        return (
          <g key={d.mes}>
            <rect x={x} y={alturaMax - hRec} width={barW} height={hRec}
              rx={3} fill="var(--ok)"
              role="img" aria-label={`Receita ${d.mes}: ${centavosParaReais(d.receita)}`} />
            <rect x={x + barW + gap} y={alturaMax - hDesp} width={barW} height={hDesp}
              rx={3} fill="var(--danger)"
              role="img" aria-label={`Despesa ${d.mes}: ${centavosParaReais(d.despesa)}`} />
            <text x={x + groupW / 2} y={alturaMax + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {mesLabel}
            </text>
          </g>
        );
      })}
      <g>
        <rect x={0} y={alturaMax + 20} width={8} height={8} rx={2} fill="var(--ok)" />
        <text x={12} y={alturaMax + 28} fontSize="9" fill="var(--text-muted)">Receita</text>
        <rect x={60} y={alturaMax + 20} width={8} height={8} rx={2} fill="var(--danger)" />
        <text x={72} y={alturaMax + 28} fontSize="9" fill="var(--text-muted)">Despesa</text>
      </g>
    </svg>
  );
}

// ── Grafico Saldo Projetado (SVG puro) ─────────────────────────────────────

function GraficoSaldoProjetado({ dados }: { readonly dados: readonly SaldoProjetadoItem[] }) {
  if (dados.length === 0) return null;
  const maxVal = Math.max(...dados.map((d) => d.saldo), 1);
  const minVal = Math.min(...dados.map((d) => d.saldo), 0);
  const range = maxVal - minVal || 1;
  const w = 300;
  const h = 100;
  const padX = 10;
  const padY = 10;

  const pontos = dados.map((d, i) => {
    const x = padX + (i / Math.max(dados.length - 1, 1)) * (w - 2 * padX);
    const y = padY + (1 - (d.saldo - minVal) / range) * (h - 2 * padY);
    return { x, y, ...d };
  });

  const pathD = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg
      role="img" aria-label="Saldo projetado"
      viewBox={`0 0 ${w} ${h + 20}`}
      style={{ width: '100%', maxWidth: `${w}px`, height: `${h + 20}px` }}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pontos.map((p) => (
        <circle key={p.dia} cx={p.x} cy={p.y} r={3} fill="var(--accent)"
          role="img" aria-label={`${p.dia}: ${centavosParaReais(p.saldo)}`} />
      ))}
      {pontos.map((p, i) => {
        if (i % 2 !== 0 && i !== pontos.length - 1) return null;
        return (
          <text key={`l-${p.dia}`} x={p.x} y={h + 14}
            textAnchor="middle" fontSize="9" fill="var(--text-muted)">
            {p.dia.slice(8)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Componente principal ───────────────────────────────────────────────────

export function FinanceiroVisao(p: FinanceiroVisaoProps) {
  const [dados, setDados] = useState<VisaoDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)' }}>
      {/* Resumo do mes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 'var(--s-6)' }}>
        {([
          { rotulo: 'Receita', valor: dados.resumoMes.receitaTotal, cor: '--ok' },
          { rotulo: 'Despesa', valor: dados.resumoMes.despesaTotal, cor: '--danger' },
          { rotulo: 'Saldo', valor: dados.resumoMes.saldo, cor: '--accent' },
        ] as const).map((item) => (
          <div key={item.rotulo} style={{
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', padding: 'var(--s-6)',
          }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {item.rotulo}
            </span>
            <p className="num" style={{
              fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
              margin: `var(--s-2) 0 0`, fontVariantNumeric: 'tabular-nums',
              color: `var(${item.cor})`,
            }}>
              {centavosParaReais(item.valor)}
            </p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {dados.alertas.length > 0 ? (
        <section aria-label="Alertas financeiros" style={{ display: 'grid', gap: 'var(--s-3)' }}>
          {dados.alertas.map((a) => (
            <div key={a.tipo} role="alert" style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderRadius: 'var(--r-md)',
              background: `var(${BG_SEVERIDADE[a.severidade] ?? '--warn-soft'})`,
              color: `var(${TOKEN_SEVERIDADE[a.severidade] ?? '--warn'})`,
              fontSize: 'var(--fs-13)',
            }}>
              <span aria-hidden="true" style={{ fontWeight: 'var(--fw-semibold)' }}>
                {GLIFO_SEVERIDADE[a.severidade] ?? '!'}
              </span>
              {a.mensagem}
            </div>
          ))}
        </section>
      ) : null}

      {/* Receita vs Despesa */}
      <section aria-label="Receita vs despesa" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Receita vs despesa
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <GraficoReceitaDespesa dados={dados.receitaVsDespesa} />
        </div>
      </section>

      {/* Saldo projetado */}
      <section aria-label="Saldo projetado" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Saldo projetado
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <GraficoSaldoProjetado dados={dados.saldoProjetado} />
        </div>
      </section>

      {/* Top 5 categorias */}
      <section aria-label="Top categorias" style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', padding: 'var(--s-6)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                     margin: `0 0 var(--s-4)` }}>
          Top categorias
        </h2>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                     gap: 'var(--s-3)' }}>
          {dados.topCategorias.map((c) => (
            <li key={c.nome} style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-2) 0', borderBottom: 'var(--border)',
              fontSize: 'var(--fs-14)',
            }}>
              <span>{c.nome}</span>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums',
                                              color: 'var(--text-muted)' }}>
                {centavosParaReais(c.total)}
              </span>
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums',
                                              fontWeight: 'var(--fw-medium)',
                                              minWidth: '3ch', textAlign: 'right' }}>
                {c.percentual}%
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
