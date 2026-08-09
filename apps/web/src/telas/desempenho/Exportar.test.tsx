// apps/web/src/telas/desempenho/Exportar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Exportar, type ExportarProps } from './Exportar';
import type { SavedView, DataFreshness } from './types';

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<ExportarProps> = {}) {
  const props: ExportarProps = {
    savedViews: VIEWS,
    freshness: FRESHNESS,
    aoExportar: vi.fn(async () => {}),
    ...over,
  };
  render(<Exportar {...props} />);
  return props;
}

describe('tela Exportar (Desempenho)', () => {
  it('exibe o titulo Exportar', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: /Exportar/ })).toBeVisible();
  });

  it('lista as visoes salvas para selecao', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'Receita por procedimento' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Atendimentos por profissional' })).toBeVisible();
  });

  it('exibe seletor de formato CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'XLSX' })).toBeVisible();
  });

  it('exibe campos de data de inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/De/)).toBeVisible();
    expect(screen.getByLabelText(/^Ate$/)).toBeVisible();
  });

  it('botao exportar chama callback com visao, formato e periodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: 'Receita por procedimento' }));
    await userEvent.click(screen.getByRole('radio', { name: 'CSV' }));
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ viewId: 'v1', format: 'csv' }));
  });

  it('botao fica desabilitado sem visao selecionada', () => {
    montar();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeDisabled();
  });

  it('exibe carimbo de frescor dos dados', () => {
    montar();
    expect(screen.getByText(/dados ate/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Exportar
        savedViews={VIEWS}
        freshness={FRESHNESS}
        aoExportar={async () => {}}
      />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
