import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ExportarDados } from './ExportarDados';

const noop = vi.fn().mockResolvedValue(undefined);

function dataset(name: string) {
  return screen.getByRole('radio', { name: new RegExp(`^${name}`) });
}

function exportButton() {
  return screen.getByRole('button', { name: 'Gerar arquivo' });
}

describe('ExportarDados', () => {
  it('renderiza todas as opções de dataset', () => {
    render(<ExportarDados aoExportar={noop} />);

    expect(dataset('Pacientes')).toBeInTheDocument();
    expect(dataset('Equipe')).toBeInTheDocument();
    expect(dataset('Agendamentos')).toBeInTheDocument();
    expect(dataset('Financeiro')).toBeInTheDocument();
  });

  it('mostra campos de período para agendamentos', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();

    await user.click(dataset('Agendamentos'));

    expect(screen.getByLabelText('De')).toBeInTheDocument();
    expect(screen.getByLabelText('Até')).toBeInTheDocument();
  });

  it('mostra campos de período para financeiro', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(dataset('Financeiro'));

    expect(screen.getByLabelText('De')).toBeInTheDocument();
    expect(screen.getByLabelText('Até')).toBeInTheDocument();
  });

  it('esconde campos de período para pacientes', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(dataset('Pacientes'));

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();
  });

  it('esconde campos de período para equipe', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(dataset('Equipe'));

    expect(screen.queryByLabelText('De')).not.toBeInTheDocument();
  });

  it('chama aoExportar com payload correto para pacientes', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={handler} />);

    await user.click(dataset('Pacientes'));
    await user.click(screen.getByRole('radio', { name: /xlsx/i }));
    await user.click(exportButton());

    expect(handler).toHaveBeenCalledWith({
      dataset: 'pacientes',
      format: 'xlsx',
    });
  });

  it('chama aoExportar com período para agendamentos', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={handler} />);

    await user.click(dataset('Agendamentos'));
    await user.type(screen.getByLabelText('De'), '2026-01-01');
    await user.type(screen.getByLabelText('Até'), '2026-06-30');
    await user.click(exportButton());

    expect(handler).toHaveBeenCalledWith({
      dataset: 'agendamentos',
      format: 'csv',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
  });

  it('desabilita botão enquanto exporta', async () => {
    let resolve: () => void;
    const slow = vi.fn().mockReturnValue(
      new Promise<void>((r) => { resolve = r; }),
    );
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={slow} />);

    await user.click(dataset('Equipe'));
    await user.click(exportButton());

    expect(exportButton()).toBeDisabled();
    expect(screen.getByTestId('spinner-carregando')).toBeInTheDocument();

    resolve!();
  });

  it('desabilita botão sem dataset selecionado', () => {
    render(<ExportarDados aoExportar={noop} />);
    expect(exportButton()).toBeDisabled();
  });

  it('desabilita botão quando agendamentos sem período', async () => {
    const user = userEvent.setup();
    render(<ExportarDados aoExportar={noop} />);

    await user.click(dataset('Agendamentos'));

    expect(exportButton()).toBeDisabled();
  });

  it('acessibilidade (axe)', async () => {
    const { container } = render(<ExportarDados aoExportar={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
