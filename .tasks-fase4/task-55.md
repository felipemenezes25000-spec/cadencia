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