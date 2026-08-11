import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ExportarDados } from './ExportarDados';

const noop = vi.fn().mockResolvedValue(undefined);

describe('ExportarDados', () => {
  it('renderiza todas as opcoes de dataset', () => {
    render(<ExportarDados aoExportar={noop} />);

    expect(screen.getByLabelText('Pacientes')).toBeInTheDocument();
    expect(screen.getByLabelText('Equipe')).toBeInTheDocument();
    expect(screen.getByLabelText('Agendamentos')).toBeInTheDocument();
    expect(screen.getByLabelText('Financeiro')).toBeInTheDocument();
  });

  it('mostra campos de periodo para agendamentos', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Agendamentos'));

    expect(screen.getByLabelText('De')).toBeInTheDocument();
    expect(screen.getByLabelText('Ate')).toBeInTheDocument();
  });

  it('mostra campos de periodo para financeiro', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(screen.getByLabelText('Financeiro'));

    expect(screen.getByLabelText('De')).toBeInTheDocument();
    expect(screen.getByLabelText('Ate')).toBeInTheDocument();
  });

  it('esconde campos de periodo para pacientes', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(screen.getByLabelText('Pacientes'));

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();
  });

  it('esconde campos de periodo para equipe', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(screen.getByLabelText('Equipe'));

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();
  });

  it('chama aoExportar com payload correto para pacientes', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={handler} />);

    await user.click(screen.getByLabelText('Pacientes'));
    await user.click(screen.getByLabelText('XLSX'));
    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(handler).toHaveBeenCalledWith({
      dataset: 'pacientes',
      format: 'xlsx',
    });
  });

  it('chama aoExportar com periodo para agendamentos', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={handler} />);

    await user.click(screen.getByLabelText('Agendamentos'));
    await user.type(screen.getByLabelText('De'), '2026-01-01');
    await user.type(screen.getByLabelText('Ate'), '2026-06-30');
    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(handler).toHaveBeenCalledWith({
      dataset: 'agendamentos',
      format: 'csv',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
  });

  it('desabilita botao enquanto exporta', async () => {
    let resolve: () => void;
    const slow = vi.fn().mockReturnValue(
      new Promise<void>((r) => { resolve = r; }),
    );
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={slow} />);

    await user.click(screen.getByLabelText('Equipe'));
    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByTestId('spinner-carregando')).toBeInTheDocument();

    resolve!();
  });

  it('desabilita botao sem dataset selecionado', () => {
    render(<ExportarDados aoExportar={noop} />);
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
  });

  it('desabilita botao quando agendamentos sem periodo', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(screen.getByLabelText('Agendamentos'));

    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
  });

  it('acessibilidade (axe)', async () => {
    const { container } = render(<ExportarDados aoExportar={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
