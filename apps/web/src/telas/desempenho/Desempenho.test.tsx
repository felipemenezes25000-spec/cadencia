// apps/web/src/telas/desempenho/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Desempenho, type DesempenhoProps } from './Desempenho';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  DataFreshness,
} from './types';

const INDICATORS: VariationIndicator[] = [
  { metric: 'receita', deltaAbsolute: -1420000, deltaPercent: -18 },
  { metric: 'ticket_medio', deltaAbsolute: 1200, deltaPercent: 4 },
  { metric: 'ocupacao', deltaAbsolute: -9, deltaPercent: -9 },
];

const WATERFALL: WaterfallFactor[] = [
  { factorId: 'f1', label: 'Faltas e cancelamentos', valueCents: -980000 },
  { factorId: 'f2', label: 'Mix de convenio', valueCents: -310000 },
  { factorId: 'f3', label: 'Glosas nao recuperadas', valueCents: -240000 },
  { factorId: 'f4', label: 'Ticket medio', valueCents: 110000 },
];

const DRILL_DOWN: DrillDownResult = {
  dimension: 'dia_semana',
  groups: [
    { key: 'seg', label: 'Segunda', count: 22, valueCents: -600000 },
    { key: 'ter', label: 'Terca', count: 8, valueCents: -200000 },
    { key: 'qua', label: 'Quarta', count: 7, valueCents: -180000 },
  ],
  totalCount: 37,
};

const ACTIONS: SuggestedAction[] = [
  { actionId: 'sa1', label: 'Ativar confirmacao 24h antes para segundas de manha',
    href: '/conversas/automacoes?dia=segunda&horario=manha' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<DesempenhoProps> = {}) {
  const props: DesempenhoProps = {
    period: { current: '2026-07', previous: '2026-06' },
    aoMudarPeriodo: vi.fn(),
    carregarIndicadores: vi.fn(async () => ({ indicators: INDICATORS, freshness: FRESHNESS })),
    carregarWaterfall: vi.fn(async () => WATERFALL),
    carregarDrillDown: vi.fn(async () => ({ result: DRILL_DOWN, actions: ACTIONS })),
    ...over,
  };
  render(<Desempenho {...props} />);
  return props;
}

describe('tela Desempenho — Variações do período', () => {
  it('exibe o título com o período selecionado', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Desempenho/ })).toBeVisible());
    expect(screen.getByText('Julho 2026 vs Junho 2026')).toBeVisible();
  });

  it('exibe três frases de variação em linguagem natural', async () => {
    montar();
    await waitFor(() => {
      // Use getAllByText because "Receita caiu..." appears both in h2 (destaque) and in buttons
      const allText = screen.getAllByText(/Receita caiu/);
      expect(allText.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Ticket medio subiu/)).toHaveLength(1);
      expect(screen.getAllByText(/Ocupacao caiu 9 pontos/)).toHaveLength(1);
    });
  });

  it('cada frase é um botão clicável', async () => {
    montar();
    await waitFor(() => {
      // Only check button elements, not h2 which also has "Receita caiu"
      const botoes = screen.getAllByRole('button', { name: /Receita|Ticket|Ocupacao/ });
      expect(botoes.length).toBe(3);
    });
  });

  it('clicar numa frase carrega o waterfall de decomposição', async () => {
    const props = montar();
    await waitFor(() => {
      // Wait for buttons with aria-labels, avoiding h2 which also contains "Receita caiu"
      expect(screen.getAllByRole('button', { name: /Receita caiu/ }).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(props.carregarWaterfall).toHaveBeenCalledWith('receita');
      expect(screen.getByText('Faltas e cancelamentos')).toBeVisible();
    });
  });

  it('waterfall exibe barras com valores em reais', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Receita caiu/ }).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(screen.getByText(/R\$ 9\.800/)).toBeVisible();
      expect(screen.getByText(/R\$ 3\.100/)).toBeVisible();
      expect(screen.getByText(/R\$ 2\.400/)).toBeVisible();
      expect(screen.getByText(/R\$ 1\.100/)).toBeVisible();
    });
  });

  it('clicar num fator do waterfall exibe drill-down agrupado', async () => {
    const props = montar();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Receita caiu/ }).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      expect(props.carregarDrillDown).toHaveBeenCalledWith('receita', 'f1');
      expect(screen.getByText('Segunda')).toBeVisible();
      expect(screen.getByText('22')).toBeVisible();
    });
  });

  it('drill-down mostra ação sugerida com link para automações', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Receita caiu/ }).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Ativar confirmacao/ });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', '/conversas/automacoes?dia=segunda&horario=manha');
    });
  });

  it('exibe carimbo "dados até HH:MM" quando fonte é matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados até/i)).toBeVisible());
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <Desempenho
        period={{ current: '2026-07', previous: '2026-06' }}
        aoMudarPeriodo={() => {}}
        carregarIndicadores={async () => ({ indicators: INDICATORS, freshness: FRESHNESS })}
        carregarWaterfall={async () => WATERFALL}
        carregarDrillDown={async () => ({ result: DRILL_DOWN, actions: ACTIONS })}
      />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Receita caiu/ }).length).toBeGreaterThan(0);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
