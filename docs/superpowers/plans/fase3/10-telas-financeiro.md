### Task 58: Sub-navegacao financeira com tabs e layout de container

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroLayout.tsx`
- Criar `apps/web/src/telas/FinanceiroLayout.test.tsx`

**Por que**: A tela Financeiro da Fase 2 e uma pagina unica. A Fase 3 exige sub-navegacao (Visao, Caixa, A receber, A pagar, Recebimentos, Repasse, Estoque) conforme Design §5.3. O layout garante que todos os sub-modulos compartilhem cabecalho, tabs e container.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroLayout.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout, type AbaFinanceiro } from './FinanceiroLayout';

const ABAS: AbaFinanceiro[] = [
  'visao', 'caixa', 'a-receber', 'a-pagar', 'recebimentos', 'repasse', 'estoque',
];

function montar(abaAtiva: AbaFinanceiro = 'visao') {
  const aoNavegar = vi.fn();
  render(
    <FinanceiroLayout abaAtiva={abaAtiva} aoNavegar={aoNavegar}>
      <div data-testid="conteudo-filho">Conteudo da aba</div>
    </FinanceiroLayout>,
  );
  return { aoNavegar };
}

describe('FinanceiroLayout', () => {
  it('renderiza o titulo "Financeiro"', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
  });

  it('renderiza todas as 7 abas como links de navegacao', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao financeiro/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /Visao/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /^Caixa$/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A receber/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A pagar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Recebimentos/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Repasse/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Estoque/i })).toBeVisible();
  });

  it('marca a aba ativa com aria-current="page"', () => {
    montar('caixa');
    const link = screen.getByRole('link', { name: /^Caixa$/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Visao/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em outra aba chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('visao');
    await userEvent.click(screen.getByRole('link', { name: /A pagar/i }));
    expect(aoNavegar).toHaveBeenCalledWith('a-pagar');
  });

  it('renderiza o conteudo filho dentro do container', () => {
    montar();
    expect(screen.getByTestId('conteudo-filho')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="visao" aoNavegar={() => {}}>
        <div>Conteudo</div>
      </FinanceiroLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroLayout.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroLayout'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroLayout.tsx`:

```tsx
// apps/web/src/telas/FinanceiroLayout.tsx
'use client';

import type { ReactNode } from 'react';

export type AbaFinanceiro =
  | 'visao' | 'caixa' | 'a-receber' | 'a-pagar'
  | 'recebimentos' | 'repasse' | 'estoque';

export interface AbaConfig {
  readonly slug: AbaFinanceiro;
  readonly rotulo: string;
  readonly href: string;
}

export const ABAS_FINANCEIRO: readonly AbaConfig[] = [
  { slug: 'visao',         rotulo: 'Visao',         href: '/financeiro/visao' },
  { slug: 'caixa',         rotulo: 'Caixa',         href: '/financeiro/caixa' },
  { slug: 'a-receber',     rotulo: 'A receber',     href: '/financeiro/a-receber' },
  { slug: 'a-pagar',       rotulo: 'A pagar',       href: '/financeiro/a-pagar' },
  { slug: 'recebimentos',  rotulo: 'Recebimentos',  href: '/financeiro/recebimentos' },
  { slug: 'repasse',       rotulo: 'Repasse',       href: '/financeiro/repasse' },
  { slug: 'estoque',       rotulo: 'Estoque',       href: '/financeiro/estoque' },
];

export interface FinanceiroLayoutProps {
  readonly abaAtiva: AbaFinanceiro;
  readonly aoNavegar: (aba: AbaFinanceiro) => void;
  readonly children: ReactNode;
}

export function FinanceiroLayout({ abaAtiva, aoNavegar, children }: FinanceiroLayoutProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1120, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      <nav aria-label="Sub-navegacao financeiro">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)',
                     overflowX: 'auto' }}>
          {ABAS_FINANCEIRO.map((aba) => {
            const ativo = aba.slug === abaAtiva;
            return (
              <li key={aba.slug}>
                <a
                  href={aba.href}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); aoNavegar(aba.slug); }}
                  style={{
                    display: 'inline-block',
                    padding: `var(--s-4) var(--s-5)`,
                    color: ativo ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                    fontSize: 'var(--fs-14)',
                    textDecoration: 'none',
                    borderBottom: ativo
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    minHeight: 24,
                  }}
                >
                  {aba.rotulo}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroLayout.test.tsx 2>&1 | tail -5
# Esperado: Tests  6 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroLayout.tsx apps/web/src/telas/FinanceiroLayout.test.tsx
git commit -m "feat(web): add FinanceiroLayout with sub-navigation tabs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 59: Tela Visao — dashboard expandido com graficos visx

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroVisao.tsx`
- Criar `apps/web/src/telas/FinanceiroVisao.test.tsx`

**Por que**: A aba Visao e o ponto de entrada do financeiro. Mostra receita vs despesa (bar chart visx), saldo projetado (line chart visx), top 5 categorias e alertas. Numeros com `font-variant-numeric: tabular-nums` conforme Design §6.3.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroVisao.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroVisao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { FinanceiroVisao, type FinanceiroVisaoProps } from './FinanceiroVisao';

const DADOS: FinanceiroVisaoProps['dados'] = {
  receitaVsDespesa: [
    { mes: '2026-06', receita: 320000, despesa: 180000 },
    { mes: '2026-07', receita: 280000, despesa: 190000 },
    { mes: '2026-08', receita: 350000, despesa: 170000 },
  ],
  saldoProjetado: [
    { dia: '2026-08-01', saldo: 150000 },
    { dia: '2026-08-07', saldo: 180000 },
    { dia: '2026-08-14', saldo: 210000 },
    { dia: '2026-08-21', saldo: 250000 },
    { dia: '2026-08-28', saldo: 300000 },
  ],
  topCategorias: [
    { nome: 'Consulta', total: 200000, percentual: 57 },
    { nome: 'Retorno', total: 80000, percentual: 23 },
    { nome: 'Exame', total: 40000, percentual: 11 },
    { nome: 'Procedimento', total: 20000, percentual: 6 },
    { nome: 'Outros', total: 10000, percentual: 3 },
  ],
  alertas: [
    { tipo: 'a-receber-vencido', mensagem: '3 lancamentos vencidos ha mais de 30 dias', severidade: 'danger' },
    { tipo: 'estoque-baixo', mensagem: 'Luva P abaixo do minimo (5 unidades)', severidade: 'warn' },
  ],
  resumoMes: {
    receitaTotal: 350000,
    despesaTotal: 170000,
    saldo: 180000,
  },
};

function montar() {
  const carregarDados = vi.fn(async () => DADOS);
  render(<FinanceiroVisao carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroVisao', () => {
  it('exibe o resumo do mes com receita, despesa e saldo formatados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(screen.getByText('R$ 1.700,00')).toBeVisible();
    expect(screen.getByText('R$ 1.800,00')).toBeVisible();
  });

  it('renderiza o grafico de receita vs despesa como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Receita vs despesa/i })).toBeVisible());
  });

  it('renderiza o grafico de saldo projetado como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Saldo projetado/i })).toBeVisible());
  });

  it('exibe a secao top 5 categorias com nomes e percentuais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(screen.getByText('57%')).toBeVisible();
    expect(screen.getByText('Retorno')).toBeVisible();
  });

  it('exibe os alertas com a mensagem e indicador de severidade', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByText(/3 lancamentos vencidos/)).toBeVisible());
    expect(screen.getByText(/Luva P abaixo do minimo/)).toBeVisible();
  });

  it('valores monetarios usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    const el = screen.getByText('R$ 3.500,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroVisao carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroVisao.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroVisao'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroVisao.tsx`:

```tsx
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroVisao.test.tsx 2>&1 | tail -5
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroVisao.tsx apps/web/src/telas/FinanceiroVisao.test.tsx
git commit -m "feat(web): add FinanceiroVisao dashboard with charts and alerts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 60: Tela Caixa — extrato do dia com filtro por conta e periodo

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroCaixa.tsx`
- Criar `apps/web/src/telas/FinanceiroCaixa.test.tsx`

**Por que**: A aba Caixa mostra o extrato do dia por conta bancaria com total e filtros por conta e periodo. Filtros viram query string via nuqs.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroCaixa.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroCaixa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroCaixa, type CaixaDados } from './FinanceiroCaixa';

const DADOS: CaixaDados = {
  lancamentos: [
    { id: 'e1', descricao: 'Consulta — Maria Souza', amountCents: 25000,
      kind: 'receita', method: 'Pix', paidAt: '2026-08-06T10:30:00Z',
      categoryName: 'Consulta' },
    { id: 'e2', descricao: 'Material de escritorio', amountCents: 5000,
      kind: 'despesa', method: 'Dinheiro', paidAt: '2026-08-06T11:00:00Z',
      categoryName: 'Materiais' },
    { id: 'e3', descricao: 'Retorno — Joao Silva', amountCents: 15000,
      kind: 'receita', method: 'Cartao', paidAt: '2026-08-06T14:00:00Z',
      categoryName: 'Retorno' },
  ],
  totalReceita: 40000,
  totalDespesa: 5000,
  saldo: 35000,
  contas: [
    { id: 'c1', nome: 'Conta principal' },
    { id: 'c2', nome: 'Caixa fisico' },
  ],
};

function montar() {
  const carregarDados = vi.fn(async (_filtros: {
    contaId?: string; dataInicio?: string; dataFim?: string;
  }) => DADOS);
  render(<FinanceiroCaixa carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroCaixa', () => {
  it('exibe o saldo do periodo formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
  });

  it('exibe totais de receita e despesa separados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 400,00')).toBeVisible());
    expect(screen.getByText('R$ 50,00')).toBeVisible();
  });

  it('lista os lancamentos com descricao, valor e metodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    expect(screen.getByText(/Material de escritorio/)).toBeVisible();
    expect(screen.getByText(/Joao Silva/)).toBeVisible();
  });

  it('receitas exibem sinal positivo e despesas sinal negativo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('+ R$ 250,00')).toBeVisible());
    expect(screen.getByText('- R$ 50,00')).toBeVisible();
  });

  it('tem filtro por periodo com campos de data', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
  });

  it('tem filtro por conta bancaria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta/i)).toBeVisible());
  });

  it('ao clicar em Filtrar recarrega os dados com os filtros', async () => {
    const { carregarDados } = montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    const dataInicio = screen.getByLabelText(/Data inicio/i);
    await userEvent.type(dataInicio, '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/i }));
    expect(carregarDados).toHaveBeenCalledTimes(2);
  });

  it('valores usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    const el = screen.getByText('R$ 350,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroCaixa carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroCaixa.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroCaixa'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroCaixa.tsx`:

```tsx
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroCaixa.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroCaixa.tsx apps/web/src/telas/FinanceiroCaixa.test.tsx
git commit -m "feat(web): add FinanceiroCaixa with statement and filters

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 61: Tela A Receber — lista com aging colorido e acoes

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroAReceber.tsx`
- Criar `apps/web/src/telas/FinanceiroAReceber.test.tsx`

**Por que**: A aba A receber lista entries pendentes com aging visual (verde ate 15d, ambar 15-30d, rubi >30d) e acoes (cobrar, marcar pago, enviar link).

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroAReceber.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAReceber.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

const HOJE = '2026-08-06';

const DADOS: AReceberDados = {
  total: 100000,
  entradas: [
    { id: 'e1', patientName: 'Maria Souza', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-01', daysPastDue: 5 },
    { id: 'e2', patientName: 'Joao Silva', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-07-15', daysPastDue: 22 },
    { id: 'e3', patientName: 'Ana Costa', description: 'Exame',
      amountCents: 25000, dueDate: '2026-07-01', daysPastDue: 36 },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoCobrar: vi.fn(async () => {}),
    aoMarcarPago: vi.fn(async () => {}),
    aoEnviarLink: vi.fn(async () => {}),
    hoje: HOJE,
  };
  render(<FinanceiroAReceber {...props} />);
  return props;
}

describe('FinanceiroAReceber', () => {
  it('exibe o total a receber formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.000,00')).toBeVisible());
  });

  it('lista as entradas pendentes com nome do paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
  });

  it('aging verde para ate 15 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('ok');
  });

  it('aging ambar para 15-30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('warn');
  });

  it('aging rubi para mais de 30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Ana Costa')).toBeVisible());
    const linha = screen.getByText('Ana Costa').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('danger');
  });

  it('cada entrada tem botoes de acao: Cobrar, Marcar pago, Enviar link', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Cobrar/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Enviar link/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('e1');
  });

  it('ao clicar em Enviar link chama aoEnviarLink com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Enviar link/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEnviarLink).toHaveBeenCalledWith('e2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAReceber
        carregarDados={async () => DADOS}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAReceber.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroAReceber'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroAReceber.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAReceber.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface EntradaPendenteReceber {
  readonly id: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly daysPastDue: number;
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

type AgingLevel = 'ok' | 'warn' | 'danger';

function calcularAging(daysPastDue: number): AgingLevel {
  if (daysPastDue > 30) return 'danger';
  if (daysPastDue > 15) return 'warn';
  return 'ok';
}

const AGING_BORDA: Record<AgingLevel, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroAReceber(p: FinanceiroAReceberProps) {
  const [dados, setDados] = useState<AReceberDados | null>(null);

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          A receber
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.total)}
        </span>
      </div>

      {/* Lista */}
      <section aria-label="Lancamentos a receber">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.entradas.map((e) => {
            const aging = calcularAging(e.daysPastDue);
            return (
              <li key={e.id} data-aging={aging} style={{
                display: 'grid',
                gridTemplateColumns: '4px 1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                paddingInlineStart: 0,
                borderBottom: 'var(--border)', minHeight: 44,
              }}>
                {/* Barra lateral de aging */}
                <span style={{
                  display: 'block', width: 4, alignSelf: 'stretch',
                  background: AGING_BORDA[aging], borderRadius: 'var(--r-sm)',
                }} aria-hidden="true" />

                <div style={{ paddingInlineStart: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                    {e.daysPastDue > 0 ? ` (${e.daysPastDue}d atraso)` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span className="num" style={{ fontSize: 'var(--fs-14)',
                                                  fontVariantNumeric: 'tabular-nums',
                                                  marginInlineEnd: 'var(--s-3)' }}>
                    {centavosParaReais(e.amountCents)}
                  </span>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoCobrar(e.id); }}>
                    Cobrar
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoMarcarPago(e.id); }}>
                    Marcar pago
                  </Botao>
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoEnviarLink(e.id); }}>
                    Enviar link
                  </Botao>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAReceber.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroAReceber.tsx apps/web/src/telas/FinanceiroAReceber.test.tsx
git commit -m "feat(web): add FinanceiroAReceber with aging colors and actions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 62: Tela A Pagar — lista de despesas pendentes com acoes

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroAPagar.tsx`
- Criar `apps/web/src/telas/FinanceiroAPagar.test.tsx`

**Por que**: A aba A pagar lista despesas pendentes com acoes (marcar pago, editar, parcelar), filtro por fornecedor/categoria/vencimento.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroAPagar.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroAPagar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAPagar, type APagarDados } from './FinanceiroAPagar';

const DADOS: APagarDados = {
  total: 85000,
  despesas: [
    { id: 'd1', descricao: 'Aluguel', fornecedor: 'Imobiliaria XYZ',
      amountCents: 50000, dueDate: '2026-08-10', categoryName: 'Aluguel',
      status: 'pendente' },
    { id: 'd2', descricao: 'Material de limpeza', fornecedor: 'Fornecedor ABC',
      amountCents: 15000, dueDate: '2026-08-15', categoryName: 'Materiais',
      status: 'pendente' },
    { id: 'd3', descricao: 'Energia eletrica', fornecedor: 'Eletropaulo',
      amountCents: 20000, dueDate: '2026-08-20', categoryName: 'Utilidades',
      status: 'pendente' },
  ],
  categorias: ['Aluguel', 'Materiais', 'Utilidades'],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      fornecedor?: string; categoria?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS),
    aoMarcarPago: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    aoParcelar: vi.fn(async () => {}),
  };
  render(<FinanceiroAPagar {...props} />);
  return props;
}

describe('FinanceiroAPagar', () => {
  it('exibe o total a pagar formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 850,00')).toBeVisible());
  });

  it('lista as despesas pendentes com descricao e fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    expect(screen.getByText(/Imobiliaria XYZ/)).toBeVisible();
    expect(screen.getByText('Material de limpeza')).toBeVisible();
    expect(screen.getByText('Energia eletrica')).toBeVisible();
  });

  it('cada despesa tem botoes Marcar pago, Editar e Parcelar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Editar/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Parcelar/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('d1');
  });

  it('ao clicar em Editar chama aoEditar com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEditar).toHaveBeenCalledWith('d2');
  });

  it('tem filtro por fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Fornecedor/i)).toBeVisible());
  });

  it('tem filtro por categoria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Categoria/i)).toBeVisible());
  });

  it('tem filtro por periodo de vencimento', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Vencimento inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Vencimento fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAPagar
        carregarDados={async () => DADOS}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAPagar.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroAPagar'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroAPagar.tsx`:

```tsx
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroAPagar.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroAPagar.tsx apps/web/src/telas/FinanceiroAPagar.test.tsx
git commit -m "feat(web): add FinanceiroAPagar with filters and actions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 63: Tela Repasse — por profissional com visibilidade por papel

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroRepasse.tsx`
- Criar `apps/web/src/telas/FinanceiroRepasse.test.tsx`

**Por que**: A aba Repasse mostra recebimentos por profissional/periodo/status. O medico ve so o seu repasse (§5.4), a gestora ve todos.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroRepasse.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroRepasse.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroRepasse, type RepasseDados } from './FinanceiroRepasse';

const DADOS_GESTORA: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
    { id: 'p2', nome: 'Dra. Beatriz Lima', totalBruto: 350000,
      percentual: 50, totalRepasse: 175000, status: 'pago', atendimentos: 28 },
  ],
  totalRepasse: 475000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

const DADOS_MEDICO: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
  ],
  totalRepasse: 300000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

function montarGestora() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_GESTORA),
    papelAtual: 'admin_clinico' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

function montarMedico() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_MEDICO),
    papelAtual: 'profissional' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

describe('FinanceiroRepasse', () => {
  it('gestora ve todos os profissionais com seus repasses', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.getByText('Dra. Beatriz Lima')).toBeVisible();
  });

  it('exibe o total geral de repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('R$ 4.750,00')).toBeVisible());
  });

  it('exibe percentual e total de repasse por profissional', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('60%')).toBeVisible());
    expect(screen.getByText('R$ 3.000,00')).toBeVisible();
  });

  it('exibe o status do repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/Pendente/i)).toBeVisible());
    expect(screen.getByText(/Pago/i)).toBeVisible();
  });

  it('exibe a quantidade de atendimentos', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/40 atend/i)).toBeVisible());
  });

  it('medico ve so o seu proprio repasse', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByText('Dra. Beatriz Lima')).not.toBeInTheDocument();
  });

  it('tem filtro por periodo', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('gestora tem filtro por profissional', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByLabelText(/Profissional/i)).toBeVisible());
  });

  it('medico nao ve filtro por profissional', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByLabelText(/Profissional/i)).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroRepasse
        carregarDados={async () => DADOS_GESTORA}
        papelAtual="admin_clinico"
      />,
    );
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroRepasse.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroRepasse'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroRepasse.tsx`:

```tsx
// apps/web/src/telas/FinanceiroRepasse.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface RepasseProfissional {
  readonly id: string;
  readonly nome: string;
  readonly totalBruto: number;
  readonly percentual: number;
  readonly totalRepasse: number;
  readonly status: 'pendente' | 'pago';
  readonly atendimentos: number;
}

export interface RepasseDados {
  readonly profissionais: readonly RepasseProfissional[];
  readonly totalRepasse: number;
  readonly periodo: { readonly inicio: string; readonly fim: string };
}

export interface FiltrosRepasse {
  readonly profissionalId?: string;
  readonly status?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export type PapelRepasse = 'admin_clinico' | 'diretor_tecnico' | 'financeiro' | 'profissional';

export interface FinanceiroRepasseProps {
  readonly carregarDados: (filtros: FiltrosRepasse) => Promise<RepasseDados>;
  readonly papelAtual: PapelRepasse;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const PAPEIS_GESTAO: readonly string[] = ['admin_clinico', 'diretor_tecnico', 'financeiro'];

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroRepasse(p: FinanceiroRepasseProps) {
  const [dados, setDados] = useState<RepasseDados | null>(null);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [profissionalId, setProfissionalId] = useState('');

  const ehGestao = PAPEIS_GESTAO.includes(p.papelAtual);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      profissionalId: profissionalId === '' ? undefined : profissionalId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        {ehGestao ? (
          <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
            <label htmlFor="filtro-profissional-rep" style={{
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              lineHeight: 1.3, color: 'var(--text-muted)',
            }}>
              Profissional
            </label>
            <select
              id="filtro-profissional-rep"
              value={profissionalId}
              onChange={(e) => setProfissionalId(e.target.value)}
              aria-label="Profissional"
              style={{
                height: 32, padding: '0 var(--s-4)',
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 'var(--fs-14)',
              }}
            >
              <option value="">Todos</option>
              {dados.profissionais.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.nome}</option>
              ))}
            </select>
          </div>
        ) : null}
        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Repasse
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.totalRepasse)}
        </span>
      </div>

      {/* Lista por profissional */}
      <section aria-label="Repasse por profissional">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.profissionais.map((pr) => (
            <li key={pr.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                  {pr.nome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {pr.atendimentos} atendimentos — Bruto {centavosParaReais(pr.totalBruto)} — {pr.percentual}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <span className="num" style={{
                  fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {centavosParaReais(pr.totalRepasse)}
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                  fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                  borderRadius: 'var(--r-full)',
                  color: pr.status === 'pago' ? 'var(--ok)' : 'var(--warn)',
                  background: 'var(--surface-sunken)',
                }}>
                  <span aria-hidden="true">{pr.status === 'pago' ? '✓' : '⏱'}</span>
                  {pr.status === 'pago' ? 'Pago' : 'Pendente'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroRepasse.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroRepasse.tsx apps/web/src/telas/FinanceiroRepasse.test.tsx
git commit -m "feat(web): add FinanceiroRepasse with role-based visibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 64: Tela Estoque — lista de produtos com nivel e alertas

**Arquivos**

- Criar `apps/web/src/telas/FinanceiroEstoque.tsx`
- Criar `apps/web/src/telas/FinanceiroEstoque.test.tsx`

**Por que**: A aba Estoque lista produtos com nivel de estoque, alertas de estoque baixo e historico de movimentacoes. Consome dados do pacote `packages/inventory` (atualmente stub vazio, preenchido em bloco anterior da Fase 3).

- [ ] Criar o arquivo de teste `apps/web/src/telas/FinanceiroEstoque.test.tsx`:

```tsx
// apps/web/src/telas/FinanceiroEstoque.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroEstoque, type EstoqueDados } from './FinanceiroEstoque';

const DADOS: EstoqueDados = {
  produtos: [
    { id: 'pr1', nome: 'Luva P', quantidade: 5, minimo: 20, unidade: 'cx',
      ultimaMovimentacao: '2026-08-05', alertaBaixo: true },
    { id: 'pr2', nome: 'Seringa 10ml', quantidade: 150, minimo: 50, unidade: 'un',
      ultimaMovimentacao: '2026-08-04', alertaBaixo: false },
    { id: 'pr3', nome: 'Gaze esteril', quantidade: 30, minimo: 40, unidade: 'pct',
      ultimaMovimentacao: '2026-08-03', alertaBaixo: true },
  ],
  movimentacoes: [
    { id: 'm1', produtoNome: 'Luva P', tipo: 'saida', quantidade: 10,
      data: '2026-08-05', responsavel: 'Maria' },
    { id: 'm2', produtoNome: 'Seringa 10ml', tipo: 'entrada', quantidade: 100,
      data: '2026-08-04', responsavel: 'Joao' },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoRegistrarMovimentacao: vi.fn(async () => {}),
  };
  render(<FinanceiroEstoque {...props} />);
  return props;
}

describe('FinanceiroEstoque', () => {
  it('lista os produtos com nome, quantidade e unidade', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(screen.getByText('Seringa 10ml')).toBeVisible();
    expect(screen.getByText('Gaze esteril')).toBeVisible();
  });

  it('exibe a quantidade atual e o minimo de cada produto', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('5 cx')).toBeVisible());
    expect(screen.getByText('150 un')).toBeVisible();
    expect(screen.getByText('30 pct')).toBeVisible();
  });

  it('destaca produtos com estoque abaixo do minimo com indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    const linhaLuva = screen.getByText('Luva P').closest('li');
    expect(linhaLuva).toBeTruthy();
    expect(linhaLuva!.getAttribute('data-alerta')).toBe('baixo');
  });

  it('produtos acima do minimo nao tem indicador de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Seringa 10ml')).toBeVisible());
    const linhaSeringa = screen.getByText('Seringa 10ml').closest('li');
    expect(linhaSeringa).toBeTruthy();
    expect(linhaSeringa!.getAttribute('data-alerta')).toBe('ok');
  });

  it('exibe o historico de movimentacoes recentes', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Movimentacoes recentes/i })).toBeVisible());
    expect(screen.getByText(/saida/i)).toBeVisible();
    expect(screen.getByText(/entrada/i)).toBeVisible();
  });

  it('movimentacao mostra produto, tipo, quantidade, data e responsavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria/)).toBeVisible());
    expect(screen.getByText(/Joao/)).toBeVisible();
  });

  it('tem botao para registrar nova movimentacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova movimentacao/i })).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroEstoque
        carregarDados={async () => DADOS}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroEstoque.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './FinanceiroEstoque'
```

- [ ] Criar o componente `apps/web/src/telas/FinanceiroEstoque.tsx`:

```tsx
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
                  {m.produtoNome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {m.data} — {m.responsavel}
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroEstoque.test.tsx 2>&1 | tail -5
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FinanceiroEstoque.tsx apps/web/src/telas/FinanceiroEstoque.test.tsx
git commit -m "feat(web): add FinanceiroEstoque with inventory list and alerts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
