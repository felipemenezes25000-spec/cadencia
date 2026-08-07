// apps/web/src/telas/FinanceiroCaixa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroCaixa, type CaixaDados } from './FinanceiroCaixa';

const DADOS: CaixaDados = {
  lancamentos: [
    { id: 'e1', descricao: 'Consulta — Maria Souza', amountCents: 25000,
      kind: 'receita', method: 'Pix', paidAt: '2026-08-06T10:30:00Z',
      categoryName: 'Consulta' },
    { id: 'e2', descricao: 'Material de escritorio', amountCents: 5000,
      kind: 'despesa', method: 'Dinheiro', paidAt: '2026-08-06T11:00:00Z',
      categoryName: 'Materiais' },
    { id: 'e3', descricao: 'Retorno — Joao Silva', amountCents: 15000,
      kind: 'receita', method: 'Cartao', paidAt: '2026-08-06T14:00:00Z',
      categoryName: 'Retorno' },
  ],
  totalReceita: 40000,
  totalDespesa: 5000,
  saldo: 35000,
  contas: [
    { id: 'c1', nome: 'Conta principal' },
    { id: 'c2', nome: 'Caixa fisico' },
  ],
};

function montar() {
  const carregarDados = vi.fn(async (_filtros: {
    contaId?: string; dataInicio?: string; dataFim?: string;
  }) => DADOS);
  render(<FinanceiroCaixa carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroCaixa', () => {
  it('exibe o saldo do periodo formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
  });

  it('exibe totais de receita e despesa separados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 400,00')).toBeVisible());
    expect(screen.getByText('R$ 50,00')).toBeVisible();
  });

  it('lista os lancamentos com descricao, valor e metodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    expect(screen.getByText(/Material de escritorio/)).toBeVisible();
    expect(screen.getByText(/Joao Silva/)).toBeVisible();
  });

  it('receitas exibem sinal positivo e despesas sinal negativo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('+ R$ 250,00')).toBeVisible());
    expect(screen.getByText('- R$ 50,00')).toBeVisible();
  });

  it('tem filtro por periodo com campos de data', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
  });

  it('tem filtro por conta bancaria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta/i)).toBeVisible());
  });

  it('ao clicar em Filtrar recarrega os dados com os filtros', async () => {
    const { carregarDados } = montar();
    await waitFor(() => expect(screen.getByText(/Maria Souza/)).toBeVisible());
    const dataInicio = screen.getByLabelText(/Data inicio/i);
    await userEvent.type(dataInicio, '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/i }));
    expect(carregarDados).toHaveBeenCalledTimes(2);
  });

  it('valores usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    const el = screen.getByText('R$ 350,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroCaixa carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 350,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
