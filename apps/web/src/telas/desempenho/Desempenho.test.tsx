// apps/web/src/telas/desempenho/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('tela Desempenho — Variacoes do periodo', () => {
  it('exibe o titulo com o periodo selecionado', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Desempenho/ })).toBeVisible());
    expect(screen.getByText('Julho 2026 vs Junho 2026')).toBeVisible();
  });

  it('exibe tres frases de variacao em linguagem natural', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Receita caiu R\$ 14\.200/)).toBeVisible();
      expect(screen.getByText(/Ticket medio subiu R\$ 12/)).toBeVisible();
      expect(screen.getByText(/Ocupacao caiu 9 pontos/)).toBeVisible();
    });
  });

  it('cada frase e um botao clicavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Receita|Ticket|Ocupacao/ });
    expect(botoes.length).toBe(3);
  });

  it('clicar numa frase carrega o waterfall de decomposicao', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(props.carregarWaterfall).toHaveBeenCalledWith('receita');
      expect(screen.getByText('Faltas e cancelamentos')).toBeVisible();
    });
  });

  it('waterfall exibe barras com valores em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
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
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      expect(props.carregarDrillDown).toHaveBeenCalledWith('receita', 'f1');
      expect(screen.getByText('Segunda')).toBeVisible();
      expect(screen.getByText('22')).toBeVisible();
    });
  });

  it('drill-down mostra acao sugerida com link para automacoes', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Ativar confirmacao/ });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', '/conversas/automacoes?dia=segunda&horario=manha');
    });
  });

  it('exibe carimbo "dados ate HH:MM" quando fonte e matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Desempenho
        period={{ current: '2026-07', previous: '2026-06' }}
        aoMudarPeriodo={() => {}}
        carregarIndicadores={async () => ({ indicators: INDICATORS, freshness: FRESHNESS })}
        carregarWaterfall={async () => WATERFALL}
        carregarDrillDown={async () => ({ result: DRILL_DOWN, actions: ACTIONS })}
      />);
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
