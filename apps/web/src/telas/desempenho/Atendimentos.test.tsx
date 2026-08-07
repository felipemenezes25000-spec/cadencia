// apps/web/src/telas/desempenho/Atendimentos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Atendimentos, type AtendimentosProps } from './Atendimentos';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

const ROWS: AtendimentoRow[] = [
  { key: 'a1', professionalName: 'Dr. Alceu', procedureName: 'Consulta',
    count: 45, valueCents: 1125000, avgDurationMin: 25 },
  { key: 'a2', professionalName: 'Dra. Beatriz', procedureName: 'Retorno',
    count: 22, valueCents: 330000, avgDurationMin: 15 },
  { key: 'a3', professionalName: 'Dr. Alceu', procedureName: 'Exame',
    count: 10, valueCents: 200000, avgDurationMin: 30 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<AtendimentosProps> = {}) {
  const props: AtendimentosProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS,
      totals: { count: 77, valueCents: 1655000 } })),
    ...over,
  };
  render(<Atendimentos {...props} />);
  return props;
}

describe('tela Atendimentos (Desempenho)', () => {
  it('exibe o titulo Atendimentos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Atendimentos/ })).toBeVisible());
  });

  it('exibe tabela com profissional, procedimento, quantidade e valor', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getAllByText('Dr. Alceu').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('45')).toBeVisible();
    });
  });

  it('exibe totais no rodape da tabela', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('77')).toBeVisible();
    });
  });

  it('exibe a duracao media em minutos', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('25 min')).toBeVisible();
      expect(screen.getByText('15 min')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Atendimentos
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS,
          totals: { count: 77, valueCents: 1655000 } })}
      />);
    await waitFor(() => expect(screen.getAllByText('Dr. Alceu').length).toBeGreaterThanOrEqual(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
