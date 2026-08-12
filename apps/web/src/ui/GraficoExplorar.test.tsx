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
  it('renderiza SVG acessível para gráfico de barras', () => {
    render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    expect(screen.getByRole('img', { name: /gráfico/i })).toBeVisible();
  });

  it('renderiza SVG acessível para gráfico de linha', () => {
    render(
      <GraficoExplorar tipo="line" dados={DADOS_LINHA} largura={400} altura={200} />,
    );
    expect(screen.getByRole('img', { name: /gráfico/i })).toBeVisible();
  });

  it('renderiza SVG acessível para gráfico de pizza', () => {
    render(
      <GraficoExplorar tipo="pie" dados={DADOS_PIZZA} largura={400} altura={200} />,
    );
    expect(screen.getByRole('img', { name: /gráfico/i })).toBeVisible();
  });

  it('não renderiza nada para tipo table', () => {
    const { container } = render(
      <GraficoExplorar tipo="table" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renderiza barras com quantidade correta de retângulos', () => {
    render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    const rects = wrapper.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it('renderiza gráfico de linha com path', () => {
    render(
      <GraficoExplorar tipo="line" dados={DADOS_LINHA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    expect(wrapper.querySelector('path')).toBeInTheDocument();
  });

  it('renderiza gráfico de pizza com fatias', () => {
    render(
      <GraficoExplorar tipo="pie" dados={DADOS_PIZZA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    // Cada fatia gera um path
    const paths = wrapper.querySelectorAll('path[role="img"]');
    expect(paths.length).toBe(3);
  });

  it('renderiza título quando fornecido', () => {
    render(
      <GraficoExplorar
        tipo="bar"
        dados={DADOS_BARRA}
        largura={400}
        altura={200}
        titulo="Receita mensal"
      />,
    );
    expect(screen.getByText('Receita mensal')).toBeInTheDocument();
  });

  it('não renderiza título quando não fornecido', () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    expect(container.querySelector('h3')).toBeNull();
  });

  it('não renderiza nada quando dados estão vazios', () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={[]} largura={400} altura={200} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('usa cores CSS variables no gráfico de barras', () => {
    render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    const rect = wrapper.querySelector('rect[role="img"]');
    expect(rect).toBeInTheDocument();
    expect(rect?.getAttribute('fill')).toContain('var(--');
  });

  it('usa cores CSS variables no gráfico de pizza', () => {
    render(
      <GraficoExplorar tipo="pie" dados={DADOS_PIZZA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    const path = wrapper.querySelector('path[role="img"]');
    expect(path).toBeInTheDocument();
    expect(path?.getAttribute('fill')).toContain('var(--');
  });

  it('aceita cor customizada por dado', () => {
    const dados = [{ label: 'A', value: 10, cor: 'var(--ok)' }];
    render(
      <GraficoExplorar tipo="bar" dados={dados} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    const rect = wrapper.querySelector('rect[role="img"]');
    expect(rect?.getAttribute('fill')).toBe('var(--ok)');
  });

  it('aceita className customizado', () => {
    const { container } = render(
      <GraficoExplorar
        tipo="bar"
        dados={DADOS_BARRA}
        largura={400}
        altura={200}
        className="minha-classe"
      />,
    );
    expect(container.querySelector('.minha-classe')).toBeInTheDocument();
  });

  it('renderiza eixos no gráfico de barras', () => {
    render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    // visx AxisBottom e AxisLeft renderizam elementos <g> com class "visx-axis"
    const axes = wrapper.querySelectorAll('.visx-axis');
    expect(axes.length).toBeGreaterThanOrEqual(2);
  });

  it('renderiza grid no gráfico de barras', () => {
    render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    const wrapper = screen.getByRole('img', { name: /gráfico/i });
    const grid = wrapper.querySelector('.visx-rows');
    expect(grid).toBeInTheDocument();
  });

  it('sem violação de acessibilidade no gráfico de barras', async () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA} largura={400} altura={200} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sem violação de acessibilidade no gráfico de linha', async () => {
    const { container } = render(
      <GraficoExplorar tipo="line" dados={DADOS_LINHA} largura={400} altura={200} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sem violação de acessibilidade no gráfico de pizza', async () => {
    const { container } = render(
      <GraficoExplorar tipo="pie" dados={DADOS_PIZZA} largura={400} altura={200} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
