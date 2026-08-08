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