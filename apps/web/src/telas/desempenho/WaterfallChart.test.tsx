// apps/web/src/telas/desempenho/WaterfallChart.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { WaterfallChart, type WaterfallSegment } from './WaterfallChart';

/* ── Mocks para JSDOM ──────────────────────────────────────────────────── */
/* ResizeObserver e SVG mocks estão em vitest.setup.ts */

// ParentSize depende de ResizeObserver — mockar para dimensões fixas
vi.mock('@visx/responsive', () => ({
  ParentSize: ({
    children,
  }: {
    children: (args: { width: number; height: number }) => React.ReactNode;
  }) => <div>{children({ width: 500, height: 300 })}</div>,
}));

/* ── Dados de teste ────────────────────────────────────────────────────── */

const dados: WaterfallSegment[] = [
  { label: 'Receita', valor: 50000, tipo: 'positivo' },
  { label: 'Custos', valor: -20000, tipo: 'negativo' },
  { label: 'Impostos', valor: -5000, tipo: 'negativo' },
  { label: 'Lucro', valor: 25000, tipo: 'total' },
];

/* ── Testes ─────────────────────────────────────────────────────────────── */

describe('WaterfallChart', () => {
  it('renderiza barras para cada segmento', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    // Cada segmento gera pelo menos um <rect> via visx Bar
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('usa cor verde para positivo', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const bars = container.querySelectorAll('[data-testid="bar-positivo"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('fill')).toBe('var(--ok)');
    }
  });

  it('usa cor vermelha para negativo', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const bars = container.querySelectorAll('[data-testid="bar-negativo"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('fill')).toBe('var(--danger)');
    }
  });

  it('usa cor cinza para total', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const bars = container.querySelectorAll('[data-testid="bar-total"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of Array.from(bars)) {
      expect(bar.getAttribute('fill')).toBe('var(--text-muted)');
    }
  });

  it('mostra labels de valor em R$', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const svg = container.querySelector('svg');
    const text = svg?.textContent ?? '';
    expect(text).toContain('R$');
    // Receita: 50000 centavos = R$ 500
    expect(text).toContain('R$ 500');
  });

  it('é responsivo via ParentSize', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // Largura vem do mock de ParentSize (500)
    expect(svg?.getAttribute('width')).toBe('500');
  });

  it('renderiza título quando fornecido', () => {
    render(<WaterfallChart dados={dados} titulo="Resultado Financeiro" />);
    expect(screen.getByText('Resultado Financeiro')).toBeTruthy();
  });

  it('não renderiza título quando não fornecido', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const headings = container.querySelectorAll('h3');
    expect(headings.length).toBe(0);
  });

  it('renderiza linhas conectoras entre barras', () => {
    const { container } = render(<WaterfallChart dados={dados} />);
    const lines = container.querySelectorAll('[data-testid="connector-line"]');
    // 4 segmentos geram 3 conectores (último não tem)
    expect(lines.length).toBe(3);
  });

  it('suporta API legada com factors/onFactorClick', () => {
    const onFactorClick = vi.fn();
    const factors = [
      { factorId: 'f1', label: 'Consultas', valueCents: 30000 },
      { factorId: 'f2', label: 'Cancelamentos', valueCents: -10000 },
    ];
    const { container } = render(
      <WaterfallChart factors={factors} onFactorClick={onFactorClick} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renderiza sem violações de acessibilidade', async () => {
    const { container } = render(
      <WaterfallChart dados={dados} titulo="Teste acessibilidade" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
