### Task 54: Adicionar aba Convenios no FinanceiroLayout

**Arquivos**

- Modificar `apps/web/src/telas/FinanceiroLayout.tsx`
- Modificar `apps/web/src/telas/FinanceiroLayout.test.tsx`

**Por que**: O Design §5.2/§5.3 define "Convenios (a faturar, lotes, retornos e glosas)" como sub-aba do Financeiro. O FinanceiroLayout da Fase 3 tem 7 abas; a Fase 4 adiciona "Convenios" como oitava aba apontando para `/financeiro/convenios`.

- [ ] Editar o teste `apps/web/src/telas/FinanceiroLayout.test.tsx` para validar 8 abas incluindo Convenios:

```tsx
// apps/web/src/telas/FinanceiroLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout, type AbaFinanceiro } from './FinanceiroLayout';

const ABAS: AbaFinanceiro[] = [
  'visao', 'caixa', 'a-receber', 'a-pagar', 'recebimentos', 'repasse', 'convenios', 'estoque',
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

  it('renderiza todas as 8 abas como links de navegacao', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao financeiro/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /Visao/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /^Caixa$/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A receber/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /A pagar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Recebimentos/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Repasse/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Convenios/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Estoque/i })).toBeVisible();
  });

  it('marca a aba Convenios com aria-current="page" quando ativa', () => {
    montar('convenios');
    const link = screen.getByRole('link', { name: /Convenios/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Visao/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em Convenios chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('visao');
    await userEvent.click(screen.getByRole('link', { name: /Convenios/i }));
    expect(aoNavegar).toHaveBeenCalledWith('convenios');
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

- [ ] Rodar o teste e confirmar que falha porque o tipo `AbaFinanceiro` nao inclui `'convenios'`:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FinanceiroLayout.test.tsx 2>&1 | head -20
# Esperado: FAIL — Type '"convenios"' is not assignable to type 'AbaFinanceiro'
```

- [ ] Editar `apps/web/src/telas/FinanceiroLayout.tsx` para adicionar a aba Convenios:

```tsx
// apps/web/src/telas/FinanceiroLayout.tsx
'use client';

import type { ReactNode } from 'react';

export type AbaFinanceiro =
  | 'visao' | 'caixa' | 'a-receber' | 'a-pagar'
  | 'recebimentos' | 'repasse' | 'convenios' | 'estoque';

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
  { slug: 'convenios',     rotulo: 'Convenios',     href: '/financeiro/convenios' },
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
git commit -m "feat(web): add Convenios tab to FinanceiroLayout"
```

---

### Task 55: Componente ConveniosLayout com sub-abas e faixa de contadores

**Arquivos**

- Criar `apps/web/src/telas/ConveniosLayout.tsx`
- Criar `apps/web/src/telas/ConveniosLayout.test.tsx`

**Por que**: A tela de Convenios tem tres sub-abas (A faturar, Lotes, Operadoras) conforme Design §5.3. A faixa de contadores no topo exibe metricas: guias a faturar, lotes rascunho, lotes enviados, pendencias. Cada numero e um filtro clicavel, seguindo o padrao de FaixaDeContadores da Fase 1.

- [ ] Criar o teste `apps/web/src/telas/ConveniosLayout.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLayout,
  type SubAbaConvenios,
  type ContadoresConvenios,
} from './ConveniosLayout';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 14,
  lotesRascunho: 2,
  lotesEnviados: 5,
  pendencias: 3,
};

function montar(abaAtiva: SubAbaConvenios = 'a-faturar') {
  const aoNavegar = vi.fn();
  const aoFiltrar = vi.fn();
  render(
    <ConveniosLayout
      abaAtiva={abaAtiva}
      aoNavegar={aoNavegar}
      contadores={CONTADORES}
      aoFiltrar={aoFiltrar}
    >
      <div data-testid="conteudo-filho">Conteudo da sub-aba</div>
    </ConveniosLayout>,
  );
  return { aoNavegar, aoFiltrar };
}

describe('ConveniosLayout', () => {
  it('renderiza o titulo "Convenios"', () => {
    montar();
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
  });

  it('renderiza as 3 sub-abas: A faturar, Lotes, Operadoras', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao convenios/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /A faturar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Lotes/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Operadoras/i })).toBeVisible();
  });

  it('marca a sub-aba ativa com aria-current="page"', () => {
    montar('lotes');
    const link = screen.getByRole('link', { name: /Lotes/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /A faturar/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em outra sub-aba chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('a-faturar');
    await userEvent.click(screen.getByRole('link', { name: /Operadoras/i }));
    expect(aoNavegar).toHaveBeenCalledWith('operadoras');
  });

  it('renderiza a faixa de contadores com os 4 valores', () => {
    montar();
    const grupo = screen.getByRole('group', { name: /Contadores de convenios/i });
    expect(grupo).toBeVisible();
    expect(screen.getByText('14')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(screen.getByText('5')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
  });

  it('rotulos dos contadores sao corretos', () => {
    montar();
    expect(screen.getByText(/Guias a faturar/i)).toBeVisible();
    expect(screen.getByText(/Lotes rascunho/i)).toBeVisible();
    expect(screen.getByText(/Lotes enviados/i)).toBeVisible();
    expect(screen.getByText(/Pendencias/i)).toBeVisible();
  });

  it('ao clicar em um contador chama aoFiltrar com a chave correta', async () => {
    const { aoFiltrar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Guias a faturar/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('guiasAFaturar');
  });

  it('renderiza o conteudo filho dentro do container', () => {
    montar();
    expect(screen.getByTestId('conteudo-filho')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLayout
        abaAtiva="a-faturar"
        aoNavegar={() => {}}
        contadores={CONTADORES}
        aoFiltrar={() => {}}
      >
        <div>Conteudo</div>
      </ConveniosLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosLayout'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosLayout.tsx`:

```tsx
// apps/web/src/telas/ConveniosLayout.tsx
'use client';

import type { ReactNode } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type SubAbaConvenios = 'a-faturar' | 'lotes' | 'operadoras';

export interface ContadoresConvenios {
  readonly guiasAFaturar: number;
  readonly lotesRascunho: number;
  readonly lotesEnviados: number;
  readonly pendencias: number;
}

export type FiltroConvenios = keyof ContadoresConvenios;

interface SubAbaConfig {
  readonly slug: SubAbaConvenios;
  readonly rotulo: string;
  readonly href: string;
}

const SUB_ABAS: readonly SubAbaConfig[] = [
  { slug: 'a-faturar',  rotulo: 'A faturar',  href: '/financeiro/convenios' },
  { slug: 'lotes',      rotulo: 'Lotes',       href: '/financeiro/convenios/lotes' },
  { slug: 'operadoras', rotulo: 'Operadoras',  href: '/financeiro/convenios/operadoras' },
];

const ROTULOS_CONTADORES: Record<FiltroConvenios, string> = {
  guiasAFaturar: 'Guias a faturar',
  lotesRascunho: 'Lotes rascunho',
  lotesEnviados: 'Lotes enviados',
  pendencias:    'Pendencias',
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface ConveniosLayoutProps {
  readonly abaAtiva: SubAbaConvenios;
  readonly aoNavegar: (aba: SubAbaConvenios) => void;
  readonly contadores: ContadoresConvenios;
  readonly aoFiltrar: (filtro: FiltroConvenios) => void;
  readonly filtroAtivo?: FiltroConvenios;
  readonly children: ReactNode;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLayout({
  abaAtiva, aoNavegar, contadores, aoFiltrar, filtroAtivo, children,
}: ConveniosLayoutProps) {
  const chaves = Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Convenios
      </h2>

      {/* Faixa de contadores */}
      <div
        role="group" aria-label="Contadores de convenios" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {chaves.map((k, i) => (
          <button
            key={k} type="button" onClick={() => aoFiltrar(k)}
            aria-pressed={filtroAtivo === k}
            style={{
              flex: 1, border: 0,
              background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
              {contadores[k]}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {ROTULOS_CONTADORES[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Sub-abas */}
      <nav aria-label="Sub-navegacao convenios">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)' }}>
          {SUB_ABAS.map((aba) => {
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
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosLayout.tsx apps/web/src/telas/ConveniosLayout.test.tsx
git commit -m "feat(web): add ConveniosLayout with sub-tabs and counters"
```

---

### Task 56: Tela A faturar — fila de guias pendentes de inclusao em lote

**Arquivos**

- Criar `apps/web/src/telas/ConveniosAFaturar.tsx`
- Criar `apps/web/src/telas/ConveniosAFaturar.test.tsx`

**Por que**: A fila "A faturar" (`/financeiro/convenios`) lista guias pendentes de inclusao em lote, com filtros por operadora, periodo e status (completa/incompleta), selecao multipla para criar lote em batch, e badge com contagem de guias incompletas (dados faltando). Cada guia na lista e clicavel para abrir o detalhe no painel lateral.

- [ ] Criar o teste `apps/web/src/telas/ConveniosAFaturar.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosAFaturar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosAFaturar,
  type GuiaPendente,
  type AFaturarDados,
  type FiltrosAFaturar,
} from './ConveniosAFaturar';

const GUIAS: readonly GuiaPendente[] = [
  {
    id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 15000, dataAtendimento: '2026-08-01',
    status: 'completa',
  },
  {
    id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
    operadoraNome: 'Bradesco Saude', registroAns: '654321',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 18000, dataAtendimento: '2026-08-02',
    status: 'incompleta',
  },
  {
    id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '20201015', nomeProcedimento: 'Retorno',
    valorCentavos: 0, dataAtendimento: '2026-08-03',
    status: 'completa',
  },
];

const DADOS: AFaturarDados = {
  guias: GUIAS,
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_f: FiltrosAFaturar) => DADOS),
    aoCriarLote: vi.fn(async (_ids: readonly string[]) => {}),
    aoAbrirGuia: vi.fn((_id: string) => {}),
  };
  render(<ConveniosAFaturar {...props} />);
  return props;
}

describe('ConveniosAFaturar', () => {
  it('lista as guias pendentes com paciente, operadora e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
  });

  it('exibe o numero da guia em fonte mono', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('000001')).toBeVisible());
    expect(screen.getByText('000001').className).toContain('num');
  });

  it('guias incompletas tem badge de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Incompleta/i)).toBeVisible();
  });

  it('guias completas nao tem badge de incompleta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).queryByText(/Incompleta/i)).not.toBeInTheDocument();
  });

  it('cada guia tem um checkbox para selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3);
  });

  it('ao selecionar guias e clicar "Criar lote" chama aoCriarLote com os ids', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[2]!);
    const botao = screen.getByRole('button', { name: /Criar lote/i });
    await userEvent.click(botao);
    expect(props.aoCriarLote).toHaveBeenCalledWith(['g1', 'g3']);
  });

  it('botao "Criar lote" so aparece quando ha selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Criar lote/i })).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    expect(screen.getByRole('button', { name: /Criar lote/i })).toBeVisible();
  });

  it('ao clicar na linha da guia chama aoAbrirGuia com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    await userEvent.click(screen.getByText('Maria Souza'));
    expect(props.aoAbrirGuia).toHaveBeenCalledWith('g1');
  });

  it('tem filtro por operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Operadora/i)).toBeVisible());
  });

  it('tem filtro por periodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('tem filtro por status (completa/incompleta)', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Status/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosAFaturar
        carregarDados={async () => DADOS}
        aoCriarLote={async () => {}}
        aoAbrirGuia={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosAFaturar.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosAFaturar'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosAFaturar.tsx`:

```tsx
// apps/web/src/telas/ConveniosAFaturar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GuiaPendente {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly status: 'completa' | 'incompleta';
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface AFaturarDados {
  readonly guias: readonly GuiaPendente[];
  readonly operadoras: readonly OperadoraResumo[];
}

export interface FiltrosAFaturar {
  readonly operadoraId?: string;
  readonly status?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosAFaturarProps {
  readonly carregarDados: (filtros: FiltrosAFaturar) => Promise<AFaturarDados>;
  readonly aoCriarLote: (guiaIds: readonly string[]) => Promise<void>;
  readonly aoAbrirGuia: (guiaId: string) => void;
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

export function ConveniosAFaturar(p: ConveniosAFaturarProps) {
  const [dados, setDados] = useState<AFaturarDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [operadoraId, setOperadoraId] = useState('');
  const [status, setStatus] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      status: status === '' ? undefined : status,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function alternarSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-af" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-af"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-status-af" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Status
          </label>
          <select
            id="filtro-status-af"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="completa">Completa</option>
            <option value="incompleta">Incompleta</option>
          </select>
        </div>

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

      {/* Barra de acao batch */}
      {selecionadas.size > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
                      padding: 'var(--s-3) var(--s-5)',
                      background: 'var(--accent-soft)', borderRadius: 'var(--r-md)' }}>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
            {selecionadas.size} guia(s) selecionada(s)
          </span>
          <Botao variante="primario" altura={32}
            onClick={() => { void p.aoCriarLote(Array.from(selecionadas)); }}>
            Criar lote
          </Botao>
        </div>
      ) : null}

      {/* Lista de guias */}
      <section aria-label="Guias a faturar">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.guias.map((g) => (
            <li key={g.id} style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              {/* Checkbox de selecao */}
              <input
                type="checkbox"
                checked={selecionadas.has(g.id)}
                onChange={() => alternarSelecao(g.id)}
                aria-label={`Selecionar guia ${g.numeroGuia}`}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />

              {/* Dados da guia */}
              <div
                role="button" tabIndex={0}
                onClick={() => p.aoAbrirGuia(g.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.aoAbrirGuia(g.id); } }}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span className="num" style={{
                    fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                    color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  }}>
                    {g.numeroGuia}
                  </span>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {g.pacienteNome}
                  </span>
                  {g.status === 'incompleta' ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: 'var(--warn)', background: 'var(--warn-soft)',
                    }}>
                      <span aria-hidden="true">!</span>Incompleta
                    </span>
                  ) : null}
                </div>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {g.operadoraNome} — {g.nomeProcedimento} — {g.dataAtendimento}
                </span>
              </div>

              {/* Valor */}
              <span className="num" style={{
                fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {centavosParaReais(g.valorCentavos)}
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
pnpm vitest run apps/web/src/telas/ConveniosAFaturar.test.tsx 2>&1 | tail -5
# Esperado: Tests  12 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosAFaturar.tsx apps/web/src/telas/ConveniosAFaturar.test.tsx
git commit -m "feat(web): add ConveniosAFaturar billing queue screen"
```

---

### Task 57: Tela Lotes — lista de lotes por operadora com status visual

**Arquivos**

- Criar `apps/web/src/telas/ConveniosLotes.tsx`
- Criar `apps/web/src/telas/ConveniosLotes.test.tsx`

**Por que**: A tela "Lotes" (`/financeiro/convenios/lotes`) lista lotes por operadora com chip de status colorido (rascunho, enviado, processado, glosado). Acoes por lote: abrir, enviar, cancelar, baixar XML. Expandir mostra as guias do lote com valor e sequencial.

- [ ] Criar o teste `apps/web/src/telas/ConveniosLotes.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosLotes.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLotes,
  type Lote,
  type LotesDados,
} from './ConveniosLotes';

const LOTES: readonly Lote[] = [
  {
    id: 'l1', numero: 'L-2026-001', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'rascunho',
    totalGuias: 5, totalCentavos: 75000,
    criadoEm: '2026-08-05', enviadoEm: null,
    guias: [
      { id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
        codigoProcedimento: '10101012', valorCentavos: 15000, sequencial: 1 },
      { id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
        codigoProcedimento: '10101012', valorCentavos: 18000, sequencial: 2 },
    ],
  },
  {
    id: 'l2', numero: 'L-2026-002', operadoraNome: 'Bradesco Saude',
    registroAns: '654321', status: 'enviado',
    totalGuias: 3, totalCentavos: 45000,
    criadoEm: '2026-08-03', enviadoEm: '2026-08-04',
    guias: [
      { id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
        codigoProcedimento: '20201015', valorCentavos: 15000, sequencial: 1 },
    ],
  },
  {
    id: 'l3', numero: 'L-2026-003', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'processado',
    totalGuias: 8, totalCentavos: 120000,
    criadoEm: '2026-08-01', enviadoEm: '2026-08-02',
    guias: [],
  },
];

const DADOS: LotesDados = { lotes: LOTES };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoEnviar: vi.fn(async (_id: string) => {}),
    aoCancelar: vi.fn(async (_id: string) => {}),
    aoBaixarXml: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosLotes {...props} />);
  return props;
}

describe('ConveniosLotes', () => {
  it('lista os lotes com numero, operadora e total de guias', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(screen.getByText('L-2026-002')).toBeVisible();
    expect(screen.getByText('L-2026-003')).toBeVisible();
  });

  it('exibe chip de status com cores corretas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Rascunho')).toBeVisible());
    expect(screen.getByText('Enviado')).toBeVisible();
    expect(screen.getByText('Processado')).toBeVisible();
  });

  it('exibe o valor total do lote formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
    expect(screen.getByText('R$ 450,00')).toBeVisible();
  });

  it('lote rascunho tem botoes Enviar e Cancelar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Enviar/i })).toBeVisible();
    expect(within(linha!).getByRole('button', { name: /Cancelar/i })).toBeVisible();
  });

  it('lote enviado tem botao Baixar XML e nao tem Enviar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Baixar XML/i })).toBeVisible();
    expect(within(linha!).queryByRole('button', { name: /^Enviar$/i })).not.toBeInTheDocument();
  });

  it('ao clicar Enviar chama aoEnviar com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Enviar/i }));
    expect(props.aoEnviar).toHaveBeenCalledWith('l1');
  });

  it('ao clicar Baixar XML chama aoBaixarXml com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Baixar XML/i }));
    expect(props.aoBaixarXml).toHaveBeenCalledWith('l2');
  });

  it('expandir lote mostra as guias com sequencial e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const expandir = screen.getAllByRole('button', { name: /Expandir/i })[0]!;
    await userEvent.click(expandir);
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Joao Silva')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLotes
        carregarDados={async () => DADOS}
        aoEnviar={async () => {}}
        aoCancelar={async () => {}}
        aoBaixarXml={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLotes.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosLotes'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosLotes.tsx`:

```tsx
// apps/web/src/telas/ConveniosLotes.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusLote = 'rascunho' | 'enviado' | 'processado' | 'glosado';

export interface GuiaDoLote {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly valorCentavos: number;
  readonly sequencial: number;
}

export interface Lote {
  readonly id: string;
  readonly numero: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly status: StatusLote;
  readonly totalGuias: number;
  readonly totalCentavos: number;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly guias: readonly GuiaDoLote[];
}

export interface LotesDados {
  readonly lotes: readonly Lote[];
}

export interface ConveniosLotesProps {
  readonly carregarDados: () => Promise<LotesDados>;
  readonly aoEnviar: (loteId: string) => Promise<void>;
  readonly aoCancelar: (loteId: string) => Promise<void>;
  readonly aoBaixarXml: (loteId: string) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusLote, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho:   { rotulo: 'Rascunho',   glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:    { rotulo: 'Enviado',    glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  processado: { rotulo: 'Processado', glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  glosado:    { rotulo: 'Glosado',    glifo: '!', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLotes(p: ConveniosLotesProps) {
  const [dados, setDados] = useState<LotesDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Lotes
      </h2>

      <section aria-label="Lista de lotes">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.lotes.map((lote) => {
            const chip = STATUS_CHIP[lote.status];
            const expandido = expandidos.has(lote.id);

            return (
              <li key={lote.id} style={{ borderBottom: 'var(--border)' }}>
                {/* Cabecalho do lote */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center', gap: 'var(--s-4)',
                  padding: 'var(--s-5) var(--s-5)', minHeight: 56,
                }}>
                  {/* Expandir */}
                  <button
                    type="button"
                    onClick={() => alternarExpandir(lote.id)}
                    aria-expanded={expandido}
                    aria-label="Expandir"
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer',
                      fontSize: 'var(--fs-14)', color: 'var(--text-muted)',
                      width: 24, height: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {expandido ? '▾' : '▸'}
                  </button>

                  {/* Info do lote */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                      <span className="num" style={{
                        fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)',
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                      }}>
                        {lote.numero}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                        fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                        fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: chip.cor, background: chip.bg,
                      }}>
                        <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                   color: 'var(--text-muted)' }}>
                      {lote.operadoraNome} — {lote.totalGuias} guia(s) — Criado em {lote.criadoEm}
                      {lote.enviadoEm !== null ? ` — Enviado em ${lote.enviadoEm}` : ''}
                    </span>
                  </div>

                  {/* Valor total */}
                  <span className="num" style={{
                    fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {centavosParaReais(lote.totalCentavos)}
                  </span>

                  {/* Acoes */}
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {lote.status === 'rascunho' ? (
                      <>
                        <Botao variante="primario" altura={28}
                          onClick={() => { void p.aoEnviar(lote.id); }}>
                          Enviar
                        </Botao>
                        <Botao variante="fantasma" altura={28}
                          onClick={() => { void p.aoCancelar(lote.id); }}>
                          Cancelar
                        </Botao>
                      </>
                    ) : null}
                    {lote.status === 'enviado' || lote.status === 'processado' ? (
                      <Botao variante="secundario" altura={28}
                        onClick={() => { void p.aoBaixarXml(lote.id); }}>
                        Baixar XML
                      </Botao>
                    ) : null}
                  </div>
                </div>

                {/* Guias expandidas */}
                {expandido && lote.guias.length > 0 ? (
                  <div style={{ padding: '0 var(--s-5) var(--s-5)',
                                paddingInlineStart: 'calc(var(--s-5) + 24px + var(--s-4))' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                                 border: 'var(--border)', borderRadius: 'var(--r-sm)',
                                 overflow: 'hidden', background: 'var(--surface-sunken)' }}>
                      {lote.guias.map((g) => (
                        <li key={g.id} style={{
                          display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                          alignItems: 'center', gap: 'var(--s-4)',
                          padding: 'var(--s-3) var(--s-4)',
                          borderBottom: 'var(--border)', fontSize: 'var(--fs-13)',
                        }}>
                          <span className="num" style={{
                            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text-muted)', minWidth: '3ch', textAlign: 'right',
                          }}>
                            {g.sequencial}
                          </span>
                          <div>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-muted)',
                            }}>
                              {g.numeroGuia}
                            </span>
                            {' '}
                            <span>{g.pacienteNome}</span>
                          </div>
                          <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {centavosParaReais(g.valorCentavos)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
pnpm vitest run apps/web/src/telas/ConveniosLotes.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosLotes.tsx apps/web/src/telas/ConveniosLotes.test.tsx
git commit -m "feat(web): add ConveniosLotes batch listing screen"
```

---

### Task 58: Tela Operadoras — CRUD de operadoras e contratos

**Arquivos**

- Criar `apps/web/src/telas/ConveniosOperadoras.tsx`
- Criar `apps/web/src/telas/ConveniosOperadoras.test.tsx`

**Por que**: A tela "Operadoras" (`/financeiro/convenios/operadoras`) permite cadastrar e editar operadoras e seus contratos (registro ANS, versao TISS acordada, dados de contato). E o ponto de entrada para vincular paciente a convenio (tambem acessivel pelo `/pacientes/{id}`). Design §5.3 — CRUD de operadoras no escopo financeiro.

- [ ] Criar o teste `apps/web/src/telas/ConveniosOperadoras.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosOperadoras.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosOperadoras,
  type Operadora,
  type OperadorasDados,
} from './ConveniosOperadoras';

const OPERADORAS: readonly Operadora[] = [
  {
    id: 'op1', nome: 'Unimed', registroAns: '123456',
    versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
    email: 'faturamento@unimed.com.br', telefone: '(11) 3333-4444',
    ativa: true, totalPacientes: 42,
  },
  {
    id: 'op2', nome: 'Bradesco Saude', registroAns: '654321',
    versaoTiss: '4.01.00', cnpj: 'XY9876543210ZW',
    email: 'tiss@bradescosaude.com.br', telefone: '(11) 5555-6666',
    ativa: true, totalPacientes: 18,
  },
  {
    id: 'op3', nome: 'SulAmerica', registroAns: '111222',
    versaoTiss: '3.05.00', cnpj: 'SA1111222233CD',
    email: null, telefone: null,
    ativa: false, totalPacientes: 0,
  },
];

const DADOS: OperadorasDados = { operadoras: OPERADORAS };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoSalvar: vi.fn(async (_op: Partial<Operadora> & { nome: string; registroAns: string }) => {}),
    aoDesativar: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosOperadoras {...props} />);
  return props;
}

describe('ConveniosOperadoras', () => {
  it('lista as operadoras com nome, registro ANS e status', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText('SulAmerica')).toBeVisible();
    expect(screen.getByText('123456')).toBeVisible();
  });

  it('exibe a versao TISS acordada de cada operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('4.01.00')).toBeVisible();
  });

  it('exibe o total de pacientes vinculados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/42 paciente/i)).toBeVisible();
  });

  it('operadoras inativas tem indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('SulAmerica')).toBeVisible());
    const linha = screen.getByText('SulAmerica').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Inativa/i)).toBeVisible();
  });

  it('tem botao para criar nova operadora', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible());
  });

  it('ao clicar em Nova operadora abre formulario', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByRole('dialog', { name: /Nova operadora/i })).toBeVisible();
  });

  it('formulario exige nome e registro ANS', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByLabelText(/^Nome/i)).toBeVisible();
    expect(screen.getByLabelText(/Registro ANS/i)).toBeVisible();
    expect(screen.getByLabelText(/Versao TISS/i)).toBeVisible();
  });

  it('cada operadora ativa tem botao Desativar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Desativar/i })).toBeVisible();
  });

  it('ao clicar Desativar chama aoDesativar com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Desativar/i }));
    expect(props.aoDesativar).toHaveBeenCalledWith('op1');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosOperadoras
        carregarDados={async () => DADOS}
        aoSalvar={async () => {}}
        aoDesativar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosOperadoras.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosOperadoras'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosOperadoras.tsx`:

```tsx
// apps/web/src/telas/ConveniosOperadoras.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { PainelLateral } from '../ui/PainelLateral';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Operadora {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
  readonly versaoTiss: string;
  readonly cnpj: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ativa: boolean;
  readonly totalPacientes: number;
}

export interface OperadorasDados {
  readonly operadoras: readonly Operadora[];
}

export interface ConveniosOperadorasProps {
  readonly carregarDados: () => Promise<OperadorasDados>;
  readonly aoSalvar: (op: Partial<Operadora> & { nome: string; registroAns: string }) => Promise<void>;
  readonly aoDesativar: (operadoraId: string) => Promise<void>;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosOperadoras(p: ConveniosOperadorasProps) {
  const [dados, setDados] = useState<OperadorasDados | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [registroAns, setRegistroAns] = useState('');
  const [versaoTiss, setVersaoTiss] = useState('4.01.00');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function limparForm(): void {
    setNome('');
    setRegistroAns('');
    setVersaoTiss('4.01.00');
    setCnpj('');
    setEmail('');
    setTelefone('');
  }

  function salvar(): void {
    void p.aoSalvar({
      nome, registroAns, versaoTiss, cnpj,
      email: email === '' ? null : email,
      telefone: telefone === '' ? null : telefone,
    }).then(() => {
      setFormAberto(false);
      limparForm();
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Operadoras
        </h2>
        <Botao variante="primario" altura={32}
          onClick={() => { limparForm(); setFormAberto(true); }}>
          Nova operadora
        </Botao>
      </div>

      {/* Lista de operadoras */}
      <section aria-label="Operadoras cadastradas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.operadoras.map((op) => (
            <li key={op.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                    {op.nome}
                  </span>
                  <span className="num" style={{
                    fontSize: 'var(--fs-12)', fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
                  }}>
                    {op.registroAns}
                  </span>
                  {!op.ativa ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: 'var(--text-faint)', background: 'var(--surface-sunken)',
                    }}>
                      Inativa
                    </span>
                  ) : null}
                </div>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  TISS {op.versaoTiss} — {op.totalPacientes} paciente(s) vinculado(s)
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                {op.ativa ? (
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoDesativar(op.id); }}>
                    Desativar
                  </Botao>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulario de nova operadora */}
      <PainelLateral
        aberto={formAberto}
        titulo="Nova operadora"
        aoFechar={() => setFormAberto(false)}
      >
        <div style={{ display: 'grid', gap: 'var(--s-5)', marginTop: 'var(--s-4)' }}>
          <Campo rotulo="Nome" value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Nome" required />
          <Campo rotulo="Registro ANS" value={registroAns}
            onChange={(e) => setRegistroAns(e.target.value)}
            aria-label="Registro ANS" maxLength={6} required />
          <Campo rotulo="Versao TISS" value={versaoTiss}
            onChange={(e) => setVersaoTiss(e.target.value)}
            aria-label="Versao TISS" />
          <Campo rotulo="CNPJ" value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            aria-label="CNPJ" maxLength={14} />
          <Campo rotulo="E-mail" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail" />
          <Campo rotulo="Telefone" type="tel" value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            aria-label="Telefone" />
          <Botao variante="primario" altura={40} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </PainelLateral>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosOperadoras.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosOperadoras.tsx apps/web/src/telas/ConveniosOperadoras.test.tsx
git commit -m "feat(web): add ConveniosOperadoras CRUD screen"
```

---

### Task 59: Detalhe da guia — painel lateral com campos projetados e historico de ajustes

**Arquivos**

- Criar `apps/web/src/telas/DetalheGuia.tsx`
- Criar `apps/web/src/telas/DetalheGuia.test.tsx`

**Por que**: Ao clicar em uma guia na fila "A faturar" ou em uma guia de lote, abre painel lateral com os campos projetados do atendimento (paciente, operadora, procedimento, valor, prestador) e o historico de ajustes (`guia_ajuste`). O botao "Ajustar" abre formulario com `campo_alterado` e motivo obrigatorio. Usa o PainelLateral existente da Fase 1.

- [ ] Criar o teste `apps/web/src/telas/DetalheGuia.test.tsx`:

```tsx
// apps/web/src/telas/DetalheGuia.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { DetalheGuia, type GuiaDetalhe, type AjusteGuia } from './DetalheGuia';

const AJUSTES: readonly AjusteGuia[] = [
  {
    id: 'aj1', campoAlterado: 'codigo_procedimento',
    valorAnterior: '10101012', valorNovo: '10102019',
    motivo: 'Correcao para casar com tabela da operadora',
    autorNome: 'Ana Financeiro', criadoEm: '2026-08-05 14:30',
  },
];

const GUIA: GuiaDetalhe = {
  id: 'g1', numeroGuia: '000001',
  pacienteNome: 'Maria Souza', numeroCns: '123456789012345',
  operadoraNome: 'Unimed', registroAns: '123456',
  numeroCarteira: '00112233', atendimentoRn: false,
  cnes: '1234567',
  conselhoProfissional: 'CRM', numeroConselho: '12345', ufConselho: 'SP',
  cbos: '225142',
  indicacaoAcidente: '9', regimeAtendimento: '01', tipoConsulta: '1',
  codigoTabela: '22', codigoProcedimento: '10102019',
  nomeProcedimento: 'Consulta em consultorio',
  valorCentavos: 15000, dataAtendimento: '2026-08-01',
  observacao: null,
  ajustes: AJUSTES,
};

function montar(aberto = true) {
  const props = {
    aberto,
    guia: GUIA,
    aoFechar: vi.fn(),
    aoAjustar: vi.fn(async (_input: { guiaId: string; campoAlterado: string;
      valorNovo: string; motivo: string }) => {}),
  };
  render(<DetalheGuia {...props} />);
  return props;
}

describe('DetalheGuia', () => {
  it('exibe o titulo com o numero da guia', () => {
    montar();
    expect(screen.getByRole('dialog', { name: /Guia 000001/i })).toBeVisible();
  });

  it('exibe os campos projetados: paciente, operadora, procedimento', () => {
    montar();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
    expect(screen.getByText('10102019')).toBeVisible();
    expect(screen.getByText('Consulta em consultorio')).toBeVisible();
  });

  it('exibe o valor formatado em reais', () => {
    montar();
    expect(screen.getByText('R$ 150,00')).toBeVisible();
  });

  it('exibe dados do prestador: CNES, conselho, CBO', () => {
    montar();
    expect(screen.getByText('1234567')).toBeVisible();
    expect(screen.getByText(/CRM/)).toBeVisible();
    expect(screen.getByText('12345')).toBeVisible();
    expect(screen.getByText('SP')).toBeVisible();
  });

  it('exibe o historico de ajustes com campo, valores e motivo', () => {
    montar();
    const secao = screen.getByRole('region', { name: /Historico de ajustes/i });
    expect(secao).toBeVisible();
    expect(within(secao).getByText('codigo_procedimento')).toBeVisible();
    expect(within(secao).getByText('10101012')).toBeVisible();
    expect(within(secao).getByText('10102019')).toBeVisible();
    expect(within(secao).getByText(/Correcao para casar/i)).toBeVisible();
    expect(within(secao).getByText('Ana Financeiro')).toBeVisible();
  });

  it('tem botao "Ajustar" que abre formulario', async () => {
    montar();
    const botao = screen.getByRole('button', { name: /Ajustar/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(screen.getByLabelText(/Campo alterado/i)).toBeVisible();
    expect(screen.getByLabelText(/Novo valor/i)).toBeVisible();
    expect(screen.getByLabelText(/Motivo/i)).toBeVisible();
  });

  it('ao preencher e confirmar ajuste chama aoAjustar com os dados', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Ajustar/i }));
    const selectCampo = screen.getByLabelText(/Campo alterado/i);
    await userEvent.selectOptions(selectCampo, 'codigo_procedimento');
    const inputValor = screen.getByLabelText(/Novo valor/i);
    await userEvent.type(inputValor, '10101012');
    const textareaMotivo = screen.getByLabelText(/Motivo/i);
    await userEvent.type(textareaMotivo, 'Retorno ao codigo original');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar ajuste/i }));
    expect(props.aoAjustar).toHaveBeenCalledWith({
      guiaId: 'g1',
      campoAlterado: 'codigo_procedimento',
      valorNovo: '10101012',
      motivo: 'Retorno ao codigo original',
    });
  });

  it('nao renderiza quando fechado', () => {
    montar(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <DetalheGuia
        aberto
        guia={GUIA}
        aoFechar={() => {}}
        aoAjustar={async () => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheGuia.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './DetalheGuia'
```

- [ ] Criar o componente `apps/web/src/telas/DetalheGuia.tsx`:

```tsx
// apps/web/src/telas/DetalheGuia.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from '../ui/PainelLateral';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface AjusteGuia {
  readonly id: string;
  readonly campoAlterado: string;
  readonly valorAnterior: string;
  readonly valorNovo: string;
  readonly motivo: string;
  readonly autorNome: string;
  readonly criadoEm: string;
}

export interface GuiaDetalhe {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly numeroCns: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly numeroCarteira: string;
  readonly atendimentoRn: boolean;
  readonly cnes: string;
  readonly conselhoProfissional: string;
  readonly numeroConselho: string;
  readonly ufConselho: string;
  readonly cbos: string;
  readonly indicacaoAcidente: string;
  readonly regimeAtendimento: string;
  readonly tipoConsulta: string;
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly observacao: string | null;
  readonly ajustes: readonly AjusteGuia[];
}

export interface AjusteInput {
  readonly guiaId: string;
  readonly campoAlterado: string;
  readonly valorNovo: string;
  readonly motivo: string;
}

export interface DetalheGuiaProps {
  readonly aberto: boolean;
  readonly guia: GuiaDetalhe;
  readonly aoFechar: () => void;
  readonly aoAjustar: (input: AjusteInput) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const CAMPOS_AJUSTAVEIS: readonly { value: string; label: string }[] = [
  { value: 'codigo_procedimento', label: 'Codigo do procedimento' },
  { value: 'codigo_tabela', label: 'Codigo da tabela' },
  { value: 'valor_procedimento', label: 'Valor do procedimento' },
  { value: 'tipo_consulta', label: 'Tipo de consulta' },
  { value: 'regime_atendimento', label: 'Regime de atendimento' },
  { value: 'cbos', label: 'CBOS' },
];

// ── Linhas de dados ───────────────────────────────────────────────────────

function LinhaInfo({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                  padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                     textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {rotulo}
      </span>
      <span className="num" style={{ fontSize: 'var(--fs-14)', fontFamily: 'var(--font-mono)',
                                      fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </span>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function DetalheGuia(p: DetalheGuiaProps) {
  const [ajustando, setAjustando] = useState(false);
  const [campoAlterado, setCampoAlterado] = useState('');
  const [valorNovo, setValorNovo] = useState('');
  const [motivo, setMotivo] = useState('');

  function limparAjuste(): void {
    setCampoAlterado('');
    setValorNovo('');
    setMotivo('');
    setAjustando(false);
  }

  function confirmarAjuste(): void {
    void p.aoAjustar({
      guiaId: p.guia.id,
      campoAlterado,
      valorNovo,
      motivo,
    }).then(limparAjuste);
  }

  return (
    <PainelLateral
      aberto={p.aberto}
      titulo={`Guia ${p.guia.numeroGuia}`}
      aoFechar={p.aoFechar}
    >
      <div style={{ display: 'grid', gap: 'var(--s-6)', marginTop: 'var(--s-4)' }}>
        {/* Dados do paciente */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Paciente
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.pacienteNome}
          </p>
        </div>

        {/* Dados da operadora */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Operadora
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.operadoraNome}
          </p>
        </div>

        {/* Dados estruturados */}
        <div style={{ display: 'grid', gap: 0 }}>
          <LinhaInfo rotulo="Carteira" valor={p.guia.numeroCarteira} />
          <LinhaInfo rotulo="Procedimento" valor={p.guia.codigoProcedimento} />
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Descricao
            </span>
            <span style={{ fontSize: 'var(--fs-14)' }}>
              {p.guia.nomeProcedimento}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Valor
            </span>
            <span className="num" style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              {centavosParaReais(p.guia.valorCentavos)}
            </span>
          </div>
          <LinhaInfo rotulo="Data" valor={p.guia.dataAtendimento} />
          <LinhaInfo rotulo="CNES" valor={p.guia.cnes} />
          <LinhaInfo rotulo="Conselho" valor={`${p.guia.conselhoProfissional} ${p.guia.numeroConselho} ${p.guia.ufConselho}`} />
          <LinhaInfo rotulo="CBOS" valor={p.guia.cbos} />
          <LinhaInfo rotulo="Tabela" valor={p.guia.codigoTabela} />
        </div>

        {/* Botao ajustar */}
        {!ajustando ? (
          <Botao variante="secundario" altura={32} onClick={() => setAjustando(true)}>
            Ajustar
          </Botao>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--s-4)',
                        padding: 'var(--s-4)', border: 'var(--border)',
                        borderRadius: 'var(--r-md)', background: 'var(--surface-sunken)' }}>
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-campo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Campo alterado
              </label>
              <select
                id="ajuste-campo" value={campoAlterado}
                onChange={(e) => setCampoAlterado(e.target.value)}
                aria-label="Campo alterado"
                style={{
                  height: 32, padding: '0 var(--s-4)',
                  border: 'var(--border)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 'var(--fs-14)',
                }}
              >
                <option value="">Selecione</option>
                {CAMPOS_AJUSTAVEIS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Campo rotulo="Novo valor" value={valorNovo}
              onChange={(e) => setValorNovo(e.target.value)}
              aria-label="Novo valor" />
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-motivo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Motivo
              </label>
              <textarea
                id="ajuste-motivo" value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo" required
                rows={3}
                style={{
                  padding: 'var(--s-3) var(--s-4)',
                  border: 'var(--border)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
                  resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="primario" altura={32} onClick={confirmarAjuste}>
                Confirmar ajuste
              </Botao>
              <Botao variante="fantasma" altura={32} onClick={limparAjuste}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}

        {/* Historico de ajustes */}
        {p.guia.ajustes.length > 0 ? (
          <section aria-label="Historico de ajustes" style={{ display: 'grid', gap: 'var(--s-3)' }}>
            <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)',
                         textTransform: 'uppercase', letterSpacing: '.04em',
                         color: 'var(--text-muted)', margin: 0 }}>
              Historico de ajustes
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                         border: 'var(--border)', borderRadius: 'var(--r-sm)',
                         overflow: 'hidden', background: 'var(--surface-sunken)' }}>
              {p.guia.ajustes.map((aj) => (
                <li key={aj.id} style={{
                  padding: 'var(--s-3) var(--s-4)', borderBottom: 'var(--border)',
                  fontSize: 'var(--fs-13)',
                }}>
                  <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'baseline' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: 'var(--accent)' }}>
                      {aj.campoAlterado}
                    </span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-faint)' }}>
                      {aj.valorAnterior}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums' }}>
                      {aj.valorNovo}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 'var(--s-1)' }}>
                    {aj.motivo}
                  </div>
                  <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-11)',
                                marginTop: 'var(--s-1)' }}>
                    {aj.autorNome} — {aj.criadoEm}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PainelLateral>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheGuia.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/DetalheGuia.tsx apps/web/src/telas/DetalheGuia.test.tsx
git commit -m "feat(web): add DetalheGuia panel with adjustment history"
```

---

### Task 60: Chip de status TISS reutilizavel

**Arquivos**

- Criar `apps/web/src/ui/ChipDeStatusTiss.tsx`
- Criar `apps/web/src/ui/ChipDeStatusTiss.test.tsx`

**Por que**: O chip de status de lote e guia TISS (rascunho, enviado, processado, glosado, completa, incompleta) e reutilizado em multiplas telas de convenios. Ter um componente dedicado evita duplicacao e garante cores consistentes com o design system.

- [ ] Criar o teste `apps/web/src/ui/ChipDeStatusTiss.test.tsx`:

```tsx
// apps/web/src/ui/ChipDeStatusTiss.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ChipDeStatusTiss, type StatusTiss } from './ChipDeStatusTiss';

const TODOS: StatusTiss[] = [
  'rascunho', 'enviado', 'processado', 'glosado', 'completa', 'incompleta',
];

describe('ChipDeStatusTiss', () => {
  it.each(TODOS)('renderiza o status "%s" com rotulo visivel', (status) => {
    render(<ChipDeStatusTiss status={status} />);
    const el = screen.getByText(new RegExp(status, 'i'));
    expect(el).toBeVisible();
  });

  it('rascunho usa cor neutra (text-muted)', () => {
    render(<ChipDeStatusTiss status="rascunho" />);
    const el = screen.getByText(/Rascunho/i);
    expect(el).toHaveStyle({ color: 'var(--text-muted)' });
  });

  it('enviado usa cor accent', () => {
    render(<ChipDeStatusTiss status="enviado" />);
    const el = screen.getByText(/Enviado/i);
    expect(el).toHaveStyle({ color: 'var(--accent)' });
  });

  it('processado usa cor ok', () => {
    render(<ChipDeStatusTiss status="processado" />);
    const el = screen.getByText(/Processado/i);
    expect(el).toHaveStyle({ color: 'var(--ok)' });
  });

  it('glosado usa cor danger', () => {
    render(<ChipDeStatusTiss status="glosado" />);
    const el = screen.getByText(/Glosado/i);
    expect(el).toHaveStyle({ color: 'var(--danger)' });
  });

  it('incompleta usa cor warn', () => {
    render(<ChipDeStatusTiss status="incompleta" />);
    const el = screen.getByText(/Incompleta/i);
    expect(el).toHaveStyle({ color: 'var(--warn)' });
  });

  it('completa usa cor ok', () => {
    render(<ChipDeStatusTiss status="completa" />);
    const el = screen.getByText(/Completa/i);
    expect(el).toHaveStyle({ color: 'var(--ok)' });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ChipDeStatusTiss status="enviado" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/ui/ChipDeStatusTiss.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ChipDeStatusTiss'
```

- [ ] Criar o componente `apps/web/src/ui/ChipDeStatusTiss.tsx`:

```tsx
// apps/web/src/ui/ChipDeStatusTiss.tsx
'use client';

export type StatusTiss =
  | 'rascunho' | 'enviado' | 'processado' | 'glosado'
  | 'completa' | 'incompleta';

const CHIP: Record<StatusTiss, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho:    { rotulo: 'Rascunho',    glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:     { rotulo: 'Enviado',     glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  processado:  { rotulo: 'Processado',  glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  glosado:     { rotulo: 'Glosado',     glifo: '!', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
  completa:    { rotulo: 'Completa',    glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  incompleta:  { rotulo: 'Incompleta',  glifo: '!', cor: 'var(--warn)',        bg: 'var(--warn-soft)' },
};

export function ChipDeStatusTiss({ status }: { readonly status: StatusTiss }) {
  const c = CHIP[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
      fontWeight: 'var(--fw-medium)', padding: `var(--s-1) var(--s-4)`,
      borderRadius: 'var(--r-full)',
      color: c.cor, background: c.bg,
    }}>
      <span aria-hidden="true">{c.glifo}</span>{c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_TISS };
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/ui/ChipDeStatusTiss.test.tsx 2>&1 | tail -5
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/ui/ChipDeStatusTiss.tsx apps/web/src/ui/ChipDeStatusTiss.test.tsx
git commit -m "feat(web): add ChipDeStatusTiss reusable status chip"
```

---

### Task 61: Teste de integracao de navegacao Convenios dentro do Financeiro

**Arquivos**

- Criar `apps/web/src/telas/convenios-navegacao.test.tsx`

**Por que**: Valida que a navegacao completa Financeiro > Convenios > sub-abas funciona sem quebra de contrato: o FinanceiroLayout renderiza ConveniosLayout que renderiza as sub-telas corretamente. Garante que os filtros via query string (nuqs) funcionam e que os contadores aparecem.

- [ ] Criar o teste de integracao `apps/web/src/telas/convenios-navegacao.test.tsx`:

```tsx
// apps/web/src/telas/convenios-navegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout } from './FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosAFaturar, type AFaturarDados } from './ConveniosAFaturar';
import { ConveniosLotes, type LotesDados } from './ConveniosLotes';
import { ConveniosOperadoras, type OperadorasDados } from './ConveniosOperadoras';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 7, lotesRascunho: 1, lotesEnviados: 3, pendencias: 2,
};

const DADOS_FATURAR: AFaturarDados = {
  guias: [
    {
      id: 'g1', numeroGuia: '000001', pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed', registroAns: '123456',
      codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
      valorCentavos: 15000, dataAtendimento: '2026-08-01', status: 'completa',
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
};

const DADOS_LOTES: LotesDados = {
  lotes: [
    {
      id: 'l1', numero: 'L-001', operadoraNome: 'Unimed',
      registroAns: '123456', status: 'rascunho',
      totalGuias: 3, totalCentavos: 45000,
      criadoEm: '2026-08-05', enviadoEm: null, guias: [],
    },
  ],
};

const DADOS_OPERADORAS: OperadorasDados = {
  operadoras: [
    {
      id: 'op1', nome: 'Unimed', registroAns: '123456',
      versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
      email: null, telefone: null, ativa: true, totalPacientes: 10,
    },
  ],
};

describe('Navegacao completa: Financeiro > Convenios', () => {
  it('renderiza FinanceiroLayout com aba Convenios ativa contendo ConveniosLayout', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div data-testid="conteudo-afaturar">Fila</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Convenios/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByTestId('conteudo-afaturar')).toBeVisible();
  });

  it('sub-aba A faturar renderiza lista de guias', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosAFaturar
            carregarDados={async () => DADOS_FATURAR}
            aoCriarLote={async () => {}}
            aoAbrirGuia={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Carlos Melo')).toBeVisible());
    expect(screen.getByText('000001')).toBeVisible();
  });

  it('sub-aba Lotes renderiza lista de lotes', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="lotes" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosLotes
            carregarDados={async () => DADOS_LOTES}
            aoEnviar={async () => {}}
            aoCancelar={async () => {}}
            aoBaixarXml={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('L-001')).toBeVisible());
    expect(screen.getByText('Rascunho')).toBeVisible();
  });

  it('sub-aba Operadoras renderiza lista de operadoras', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="operadoras" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosOperadoras
            carregarDados={async () => DADOS_OPERADORAS}
            aoSalvar={async () => {}}
            aoDesativar={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible();
  });

  it('contadores da faixa sao botoes clicaveis', async () => {
    const aoFiltrar = vi.fn();
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={aoFiltrar}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Pendencias/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('pendencias');
  });

  it('sem violacao de acessibilidade na composicao completa', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosAFaturar
            carregarDados={async () => DADOS_FATURAR}
            aoCriarLote={async () => {}}
            aoAbrirGuia={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Carlos Melo')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que passa (todos os componentes ja existem das tasks anteriores):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/convenios-navegacao.test.tsx 2>&1 | tail -5
# Esperado: Tests  6 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/convenios-navegacao.test.tsx
git commit -m "test(web): add Convenios full navigation integration test"
```
