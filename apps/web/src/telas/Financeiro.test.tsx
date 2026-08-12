import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Financeiro } from './Financeiro';

const CAIXA_DO_DIA = {
  total: 125000,
  porMetodo: [
    { method: 'dinheiro' as const, total: 50000, count: 2 },
    { method: 'cartao' as const, total: 50000, count: 2 },
    { method: 'pix' as const, total: 25000, count: 1 },
  ],
};

const RECEITAS_DO_MES = {
  dias: [
    { dia: '2026-08-01', total: 45000 },
    { dia: '2026-08-02', total: 30000 },
    { dia: '2026-08-03', total: 50000 },
  ],
  totalMes: 125000,
  mediaDiaria: 41667,
};

const A_RECEBER = {
  total: 75000,
  entradas: [
    { entryId: 'e1', patientName: 'Joana Prado', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-05', status: 'pendente' as const },
    { entryId: 'e2', patientName: 'Carlos Dias', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-08-10', status: 'pendente' as const },
  ],
};

function montar() {
  const props = {
    carregarCaixaDoDia: vi.fn(async () => CAIXA_DO_DIA),
    carregarReceitasDoMes: vi.fn(async () => RECEITAS_DO_MES),
    carregarAReceber: vi.fn(async () => A_RECEBER),
    aoEnviarLink: vi.fn(async () => {}),
  };
  render(<Financeiro {...props} />);
  return props;
}

describe('tela Financeiro', () => {
  it('exibe o caixa do dia com total formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
  });

  it('exibe o total por método de pagamento', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Dinheiro/)).toBeVisible());
    expect(screen.getByText(/R\$ 500,00/)).toBeVisible();
  });

  it('exibe a seção de receitas do mês com total e média', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Receitas do mês/ })).toBeVisible());
    expect(screen.getByText('R$ 1.250,00')).toBeVisible();
  });

  it('renderiza o gráfico de barras como SVG acessível', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('img', { name: /Receitas/ })).toBeVisible());
  });

  it('exibe a seção A receber com lista de pendências ordenada por data', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /A receber/ })).toBeVisible());
    expect(screen.getByText('Joana Prado')).toBeVisible();
    expect(screen.getByText('Carlos Dias')).toBeVisible();
  });

  it('exibe o total pendente', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
  });

  it('cada entrada pendente tem botão "Enviar link"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Enviar link/ }).length).toBe(2));
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <Financeiro
        carregarCaixaDoDia={async () => CAIXA_DO_DIA}
        carregarReceitasDoMes={async () => RECEITAS_DO_MES}
        carregarAReceber={async () => A_RECEBER}
        aoEnviarLink={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
