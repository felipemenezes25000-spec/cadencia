// apps/web/src/telas/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Desempenho } from './Desempenho';

const PROPS_BASE = {
  visoesSalvas: [],
  aoConsultar: vi.fn(async () => ({ rows: [], total: 0 })),
  aoExportar: vi.fn(async () => {}),
  aoSalvarVisao: vi.fn(async () => ({ viewId: 'v1' })),
};

describe('tela Desempenho', () => {
  it('renderiza o titulo "Desempenho"', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('heading', { name: /Desempenho/ })).toBeVisible();
  });

  it('renderiza a sub-navegacao com aba "Explorar" ativa', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('tab', { name: /Explorar/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renderiza o componente Explorar dentro', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Desempenho {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { FASE_ATUAL, ITENS_NAV } from '../ui/nav';

describe('navegacao Desempenho', () => {
  it('FASE_ATUAL e 3', () => {
    expect(FASE_ATUAL).toBe(3);
  });

  it('item Desempenho esta disponivel na fase 3', () => {
    const item = ITENS_NAV.find((i) => i.rotulo === 'Desempenho');
    expect(item).toBeDefined();
    expect(item!.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
  });

  it('todos os itens de navegacao estao disponiveis na fase atual', () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });
});
