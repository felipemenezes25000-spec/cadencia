### Task 55: habilitar Conversas e Financeiro na barra de navegacao

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar `FASE_ATUAL` e os registros de `Conversas` e `Financeiro` em `nav.ts`. Conversas passa para fase 2 e Financeiro passa para fase 2 (recebimentos basicos).

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 2 as const;
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que o teste existente falha porque agora so Desempenho e futuro.

Saida esperada: 2 falhas — o teste `marca o que ainda nao existe, com o motivo` espera 3 itens futuros (Conversas, Financeiro, Desempenho) mas agora so Desempenho e futuro; e o teste `renderiza os itens da Fase 1 como link e os futuros como desabilitados` clica no botao Conversas que agora e link.

- [ ] Atualizar os testes para refletir a nova realidade.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 2 so Desempenho esta marcado como futuro', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('Conversas e Financeiro agora sao links navegaveis', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
  });

  it('Desempenho permanece desabilitado com motivo', () => {
    render(<BarraDeNavegacao />);
    const desempenho = screen.getByRole('button', { name: /Desempenho/ });
    expect(desempenho).toBeDisabled();
    expect(desempenho).toHaveAttribute('aria-disabled', 'true');
    expect(desempenho).toHaveAccessibleDescription(/Fase 3/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(web): enable Conversas and Financeiro nav items for Fase 2`

---