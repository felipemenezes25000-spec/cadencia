// apps/web/src/telas/FinanceiroAPagar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAPagar, type APagarDados } from './FinanceiroAPagar';

const DADOS: APagarDados = {
  total: 85000,
  despesas: [
    { id: 'd1', descricao: 'Aluguel', fornecedor: 'Imobiliaria XYZ',
      amountCents: 50000, dueDate: '2026-08-10', categoryName: 'Aluguel',
      status: 'pendente' },
    { id: 'd2', descricao: 'Material de limpeza', fornecedor: 'Fornecedor ABC',
      amountCents: 15000, dueDate: '2026-08-15', categoryName: 'Materiais',
      status: 'pendente' },
    { id: 'd3', descricao: 'Energia eletrica', fornecedor: 'Eletropaulo',
      amountCents: 20000, dueDate: '2026-08-20', categoryName: 'Utilidades',
      status: 'pendente' },
  ],
  categorias: ['Aluguel', 'Materiais', 'Utilidades'],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      fornecedor?: string; categoria?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS),
    aoMarcarPago: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    aoParcelar: vi.fn(async () => {}),
  };
  render(<FinanceiroAPagar {...props} />);
  return props;
}

describe('FinanceiroAPagar', () => {
  it('exibe o total a pagar formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 850,00')).toBeVisible());
  });

  it('lista as despesas pendentes com descricao e fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Material de limpeza')).toBeVisible());
    // 'Aluguel' aparece tanto como opcao de categoria quanto como descricao de despesa
    expect(screen.getAllByText('Aluguel').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Imobiliaria XYZ/)).toBeVisible();
    expect(screen.getByText('Energia eletrica')).toBeVisible();
  });

  it('cada despesa tem botoes Marcar pago, Editar e Parcelar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Marcar pago/i }).length).toBe(3));
    expect(screen.getAllByRole('button', { name: /Editar/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Parcelar/i }).length).toBe(3);
  });

  it('ao clicar em Marcar pago chama aoMarcarPago com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Material de limpeza')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Marcar pago/i });
    await userEvent.click(botoes[0]!);
    expect(props.aoMarcarPago).toHaveBeenCalledWith('d1');
  });

  it('ao clicar em Editar chama aoEditar com o id correto', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Material de limpeza')).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    await userEvent.click(botoes[1]!);
    expect(props.aoEditar).toHaveBeenCalledWith('d2');
  });

  it('tem filtro por fornecedor', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Fornecedor/i)).toBeVisible());
  });

  it('tem filtro por categoria', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Categoria/i)).toBeVisible());
  });

  it('tem filtro por periodo de vencimento', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Vencimento inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Vencimento fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAPagar
        carregarDados={async () => DADOS}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Material de limpeza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
