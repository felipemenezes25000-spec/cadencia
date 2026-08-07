// apps/web/src/telas/FinanceiroAReceber.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

const HOJE = '2026-08-06';

const DADOS: AReceberDados = {
  total: 100000,
  entradas: [
    { id: 'e1', patientName: 'Maria Souza', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-01', daysPastDue: 5 },
    { id: 'e2', patientName: 'Joao Silva', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-07-15', daysPastDue: 22 },
    { id: 'e3', patientName: 'Ana Costa', description: 'Exame',
      amountCents: 25000, dueDate: '2026-07-01', daysPastDue: 36 },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoCobrar: vi.fn(async () => {}),
    aoMarcarPago: vi.fn(async () => {}),
    aoEnviarLink: vi.fn(async () => {}),
    hoje: HOJE,
  };
  render(<FinanceiroAReceber {...props} />);
  return props;
}

describe('FinanceiroAReceber', () => {
  it('exibe o total a receber formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.000,00')).toBeVisible());
  });

  it('lista as entradas pendentes com nome do paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
  });

  it('aging verde para ate 15 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('ok');
  });

  it('aging ambar para 15-30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('warn');
  });

  it('aging rubi para mais de 30 dias de atraso', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Ana Costa')).toBeVisible());
    const linha = screen.getByText('Ana Costa').closest('li');
    expect(linha).toBeTruthy();
    expect(linha!.getAttribute('data-aging')).toBe('danger');
  });

  it('cada entrada tem botoes de acao: Cobrar, Marcar pago, Enviar link', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Cobrar/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Enviar link/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('e1');
  });

  it('ao clicar em Enviar link chama aoEnviarLink com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Enviar link/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEnviarLink).toHaveBeenCalledWith('e2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAReceber
        carregarDados={async () => DADOS}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
