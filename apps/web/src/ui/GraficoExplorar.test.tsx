// apps/web/src/ui/GraficoExplorar.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { GraficoExplorar } from './GraficoExplorar';

const DADOS_BARRA = [
  { label: 'Jan', value: 100 },
  { label: 'Fev', value: 200 },
  { label: 'Mar', value: 150 },
];

const DADOS_LINHA = [
  { label: '2026-07-01', value: 30 },
  { label: '2026-07-02', value: 45 },
  { label: '2026-07-03', value: 20 },
];

const DADOS_PIZZA = [
  { label: 'Pix', value: 400 },
  { label: 'Cartao', value: 300 },
  { label: 'Dinheiro', value: 200 },
];

describe('GraficoExplorar', () => {
  it('renderiza SVG acessivel para grafico de barras', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de linha', () => {
    render(<GraficoExplorar tipo="line" dados={DADOS_LINHA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de pizza', () => {
    render(<GraficoExplorar tipo="pie" dados={DADOS_PIZZA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('nao renderiza nada para tipo table', () => {
    const { container } = render(
      <GraficoExplorar tipo="table" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renderiza barras com quantidade correta de retangulos', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    const svg = screen.getByRole('img', { name: /grafico/i });
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it('sem violacao de acessibilidade no grafico de barras', async () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
