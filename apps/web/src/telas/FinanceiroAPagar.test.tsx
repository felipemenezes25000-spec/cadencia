// apps/web/src/telas/FinanceiroAPagar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAPagar, type APagarDados } from './FinanceiroAPagar';

const DADOS: APagarDados = {
  total: 82000,
  despesas: [
    {
      id: 'd1',
      descricao: 'Aluguel',
      fornecedor: 'Imobiliaria XYZ',
      amountCents: 50000,
      dueDate: '2026-08-10',
      categoryName: 'Aluguel',
      status: 'pendente',
    },
    {
      id: 'd2',
      descricao: 'Material de limpeza',
      fornecedor: 'Fornecedor ABC',
      amountCents: 15000,
      dueDate: '2026-08-15',
      categoryName: 'Materiais',
      status: 'vencido',
    },
    {
      id: 'd3',
      descricao: 'Energia eletrica',
      fornecedor: 'Eletropaulo',
      amountCents: 20000,
      dueDate: '2026-08-20',
      categoryName: 'Utilidades',
      status: 'pendente',
    },
    {
      id: 'd4',
      descricao: 'Credito fornecedor',
      fornecedor: 'Fornecedor ABC',
      amountCents: -3000,
      dueDate: '2026-08-05',
      categoryName: 'Ajustes',
      status: 'pago',
    },
  ],
  categorias: ['Aluguel', 'Materiais', 'Utilidades', 'Ajustes'],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoMarcarPago: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    aoParcelar: vi.fn(async () => {}),
  };
  render(<FinanceiroAPagar {...props} />);
  return props;
}

describe('FinanceiroAPagar', () => {
  it('renderiza skeleton enquanto carrega', () => {
    render(
      <FinanceiroAPagar
        carregarDados={() => new Promise<APagarDados>(() => {})}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renderiza tabela com dados', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(screen.getByText('Material de limpeza')).toBeVisible();
    expect(screen.getByText('Energia eletrica')).toBeVisible();
    expect(screen.getByText(/Imobiliaria XYZ/)).toBeVisible();
  });

  it('ordena ao clicar no cabeçalho de coluna', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    const thValor = screen.getByText('Valor').closest('th')!;
    await userEvent.click(thValor);
    expect(thValor.getAttribute('aria-sort')).toBe('ascending');

    await userEvent.click(thValor);
    expect(thValor.getAttribute('aria-sort')).toBe('descending');
  });

  it('filtra por data', async () => {
    const { carregarDados } = montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const de = screen.getByLabelText('De');
    fireEvent.change(de, { target: { value: '2026-08-01' } });
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/i }));
    expect(carregarDados).toHaveBeenCalledTimes(2);
  });

  it('filtra por categoria', async () => {
    const { carregarDados } = montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const selectCategoria = screen.getByLabelText('Categoria');
    await userEvent.selectOptions(selectCategoria, 'Aluguel');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/i }));
    expect(carregarDados).toHaveBeenCalledTimes(2);
  });

  it('filtra por status', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    const selectStatus = screen.getByLabelText('Status');
    await userEvent.selectOptions(selectStatus, 'pendente');

    // d1 status=pendente, d3 status=pendente
    // d2 status=vencido, d4 status=pago
    expect(screen.getByText('Energia eletrica')).toBeVisible();
    expect(
      screen.queryByText('Material de limpeza'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Credito fornecedor'),
    ).not.toBeInTheDocument();
  });

  it('mostra valores positivos em verde', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('R$ 500,00');
    expect(el.className).toContain('text-ok');
  });

  it('mostra valores negativos em vermelho', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('R$ -30,00');
    expect(el.className).toContain('text-danger');
  });

  it('mostra estado vazio quando sem resultados', async () => {
    const dadosVazios: APagarDados = {
      ...DADOS,
      despesas: [],
    };
    render(
      <FinanceiroAPagar
        carregarDados={async () => dadosVazios}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Nenhum lançamento encontrado/),
      ).toBeVisible(),
    );
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroAPagar
        carregarDados={async () => DADOS}
        aoMarcarPago={async () => {}}
        aoEditar={() => {}}
        aoParcelar={async () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
