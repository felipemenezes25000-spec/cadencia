import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Recibos } from './Recibos';

const LISTA = [
  { receiptNumber: 42, patientName: 'Maria Souza Lima', description: 'Consulta',
    amountCents: 25000, method: 'dinheiro' as const, paidAt: '2026-08-03T13:30:00.000Z',
    receiptId: 'r1' },
  { receiptNumber: 43, patientName: 'Joana Prado', description: 'Retorno',
    amountCents: 15000, method: 'pix' as const, paidAt: '2026-08-03T14:00:00.000Z',
    receiptId: 'r2' },
];

function montar() {
  const props = {
    carregarRecibos: vi.fn(async (_filtros: { dataInicio?: string; dataFim?: string; paciente?: string }) => LISTA),
    aoImprimirRecibo: vi.fn(async () => {}),
  };
  render(<Recibos {...props} />);
  return props;
}

describe('tela Recibos', () => {
  it('exibe o titulo "Recibos"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Recibos/ })).toBeVisible());
  });

  it('lista os recibos com numero sequencial, paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('R$ 250,00')).toBeVisible();
  });

  it('cada recibo tem botao "Imprimir"', async () => {
    const { aoImprimirRecibo } = montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Imprimir/ }).length).toBe(2));
    await userEvent.click(screen.getAllByRole('button', { name: /Imprimir/ })[0]!);
    expect(aoImprimirRecibo).toHaveBeenCalledWith('r1');
  });

  it('tem campos de filtro por data e paciente', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data início/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Paciente/i)).toBeVisible();
  });

  it('ao preencher filtro de paciente e disparar busca, recarrega a lista', async () => {
    const { carregarRecibos } = montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoPaciente = screen.getByLabelText(/Paciente/i);
    await userEvent.type(campoPaciente, 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    expect(carregarRecibos).toHaveBeenCalledTimes(2);
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Recibos
        carregarRecibos={async () => LISTA}
        aoImprimirRecibo={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
