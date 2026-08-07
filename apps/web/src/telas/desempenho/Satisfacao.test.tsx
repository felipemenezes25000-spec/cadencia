// apps/web/src/telas/desempenho/Satisfacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Satisfacao, type SatisfacaoProps } from './Satisfacao';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

const SUMMARY: NpsSummary = {
  score: 72,
  promoters: 45,
  passives: 20,
  detractors: 8,
  totalResponses: 73,
};

const EVOLUTION: NpsPoint[] = [
  { period: '2026-04', score: 65 },
  { period: '2026-05', score: 68 },
  { period: '2026-06', score: 70 },
  { period: '2026-07', score: 72 },
];

const BY_PROFESSIONAL: NpsByProfessional[] = [
  { professionalId: 'pr1', professionalName: 'Dr. Alceu', score: 85, responses: 30 },
  { professionalId: 'pr2', professionalName: 'Dra. Beatriz', score: 62, responses: 25 },
  { professionalId: 'pr3', professionalName: 'Dr. Carlos', score: 58, responses: 18 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<SatisfacaoProps> = {}) {
  const props: SatisfacaoProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({
      summary: SUMMARY, evolution: EVOLUTION,
      byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
    })),
    ...over,
  };
  render(<Satisfacao {...props} />);
  return props;
}

describe('tela Satisfacao (Desempenho)', () => {
  it('exibe o titulo Satisfacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Satisfacao/ })).toBeVisible());
  });

  it('exibe o score NPS em destaque', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
  });

  it('exibe a distribuicao promotores/neutros/detratores', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/45/)).toBeVisible();
      expect(screen.getByText(/Promotores/)).toBeVisible();
      expect(screen.getByText(/20/)).toBeVisible();
      expect(screen.getByText(/Neutros/)).toBeVisible();
      expect(screen.getByText(/8/)).toBeVisible();
      expect(screen.getByText(/Detratores/)).toBeVisible();
    });
  });

  it('exibe o total de respostas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/73 respostas/)).toBeVisible());
  });

  it('exibe grafico evolutivo com periodos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /NPS evolutivo/ })).toBeVisible());
  });

  it('exibe ranking por profissional', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Dr. Alceu')).toBeVisible();
      expect(screen.getByText('85')).toBeVisible();
      expect(screen.getByText('Dra. Beatriz')).toBeVisible();
      expect(screen.getByText('62')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Satisfacao
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({
          summary: SUMMARY, evolution: EVOLUTION,
          byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
        })}
      />);
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
