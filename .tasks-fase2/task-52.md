### Task 52: Dashboard financeiro basico — tela `/financeiro`

**Arquivos**

- Criar `apps/web/src/telas/Financeiro.tsx`
- Criar `apps/web/src/telas/Financeiro.test.tsx`

**Por que**: Design §5.3 define "FINANCEIRO [$] -> Visao . Caixa . A receber". O painel mostra caixa do dia por metodo, receitas do mes em grafico de barras (SVG puro), e lista de pendencias.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Financeiro.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Financeiro } from './Financeiro';

const CAIXA_DO_DIA = {
  total: 125000,
  porMetodo: [
    { method: 'dinheiro' as const, total: 50000, count: 2 },
    { method: 'cartao' as const, total: 50000, count: 2 },
    { method: 'pix' as const, total: 25000, count: 1 },
  ],
};

const RECEITAS_DO_MES = {
  dias: [
    { dia: '2026-08-01', total: 45000 },
    { dia: '2026-08-02', total: 30000 },
    { dia: '2026-08-03', total: 50000 },
  ],
  totalMes: 125000,
  mediaDiaria: 41667,
};

const A_RECEBER = {
  total: 75000,
  entradas: [
    { entryId: 'e1', patientName: 'Joana Prado', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-05', status: 'pendente' as const },
    { entryId: 'e2', patientName: 'Carlos Dias', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-08-10', status: 'pendente' as const },
  ],
};

function montar() {
  const props = {
    carregarCaixaDoDia: vi.fn(async () => CAIXA_DO_DIA),
    carregarReceitasDoMes: vi.fn(async () => RECEITAS_DO_MES),
    carregarAReceber: vi.fn(async () => A_RECEBER),
    aoEnviarLink: vi.fn(async () => {}),
  };
  render(<Financeiro {...props} />);
  return props;
}

describe('tela Financeiro', () => {
  it('exibe o caixa do dia com total formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
  });

  it('exibe o total por metodo de pagamento', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Dinheiro/)).toBeVisible());
    expect(screen.getByText(/R\$ 500,00/)).toBeVisible();
  });

  it('exibe a secao de receitas do mes com total e media', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Receitas do mês/ })).toBeVisible());
    expect(screen.getByText('R$ 1.250,00')).toBeVisible();
  });

  it('renderiza o grafico de barras como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('img', { name: /Receitas/ })).toBeVisible());
  });

  it('exibe a secao A receber com lista de pendencias ordenada por data', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /A receber/ })).toBeVisible());
    expect(screen.getByText('Joana Prado')).toBeVisible();
    expect(screen.getByText('Carlos Dias')).toBeVisible();
  });

  it('exibe o total pendente', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
  });

  it('cada entrada pendente tem botao "Enviar link"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Enviar link/ }).length).toBe(2));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Financeiro
        carregarCaixaDoDia={async () => CAIXA_DO_DIA}
        carregarReceitasDoMes={async () => RECEITAS_DO_MES}
        carregarAReceber={async () => A_RECEBER}
        aoEnviarLink={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: FAIL — modulo Financeiro nao encontrado
```

- [ ] Implementar a tela:

```tsx
// apps/web/src/telas/Financeiro.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

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
            >
              <title>{`${d.dia}: ${centavosParaReais(d.total)}`}</title>
            </rect>
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

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    void p.carregarCaixaDoDia().then(setCaixa);
    void p.carregarReceitasDoMes().then(setReceitas);
    void p.carregarAReceber().then(setAReceber);
  }, [p]);

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
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
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
                <span className="num">{centavosParaReais(m.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Receitas do mes */}
      {receitas !== null ? (
        <section aria-label="Receitas do mês"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
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
                {centavosParaReais(receitas.totalMes)}
              </p>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Média diária
              </span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                {centavosParaReais(receitas.mediaDiaria)}
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
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
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
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: 8 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Financeiro.tsx apps/web/src/telas/Financeiro.test.tsx
git commit -m "feat(web): basic financial dashboard with cash, revenue chart and receivables"
```

---