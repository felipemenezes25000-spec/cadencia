// apps/web/src/telas/desempenho/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar, type ExplorarProps } from './Explorar';
import type { ExploreRow, SavedView, DataFreshness, ChartKind } from './types';

const ROWS: ExploreRow[] = [
  { key: 'r1', label: 'Consulta', valueCents: 1500000, count: 60 },
  { key: 'r2', label: 'Retorno', valueCents: 450000, count: 30 },
  { key: 'r3', label: 'Exame', valueCents: 300000, count: 15 },
];

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T16:00:00Z' };

function montar(over: Partial<ExplorarProps> = {}) {
  const props: ExplorarProps = {
    filters: {},
    chartKind: 'bar',
    savedViews: VIEWS,
    aoMudarFiltros: vi.fn(),
    aoMudarGrafico: vi.fn(),
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS })),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'v3', name: 'Nova visão', filters: {}, chartKind: 'bar' as ChartKind })),
    aoSelecionarVisao: vi.fn(),
    ...over,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('exibe o título Explorar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Explorar/ })).toBeVisible());
  });

  it('exibe tabs de visões salvas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible();
      expect(screen.getByRole('tab', { name: 'Atendimentos por profissional' })).toBeVisible();
    });
  });

  it('clicar numa tab de visão salva chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible());
    await userEvent.click(screen.getByRole('tab', { name: 'Receita por procedimento' }));
    expect(props.aoSelecionarVisao).toHaveBeenCalledWith('v1');
  });

  it('exibe tabela com dados carregados', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('60')).toBeVisible();
    });
  });

  it('exibe os três botões de tipo de gráfico (bar/line/pie)', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Barras/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Pizza/ })).toBeVisible();
    });
  });

  it('clicar no botão de tipo de gráfico chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('radio', { name: /Linhas/ }));
    expect(props.aoMudarGrafico).toHaveBeenCalledWith('line');
  });

  it('botão Salvar visão está presente', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Salvar visão/ })).toBeVisible());
  });

  it('exibe carimbo de dados quando fonte é matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados até/i)).toBeVisible());
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        filters={{}}
        chartKind="bar"
        savedViews={VIEWS}
        aoMudarFiltros={() => {}}
        aoMudarGrafico={() => {}}
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS })}
        aoSalvarVisao={async () => ({ viewId: 'v3', name: 'Nova visão', filters: {}, chartKind: 'bar' })}
        aoSelecionarVisao={() => {}}
      />);
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
