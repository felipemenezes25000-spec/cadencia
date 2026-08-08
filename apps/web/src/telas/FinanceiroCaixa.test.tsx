// apps/web/src/telas/FinanceiroCaixa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroCaixa, type CaixaDados } from './FinanceiroCaixa';

const DADOS: CaixaDados = {
  lancamentos: [
    {
      id: 'e1',
      descricao: 'Consulta — Maria Souza',
      amountCents: 25000,
      kind: 'receita',
      method: 'Pix',
      paidAt: '2026-08-06T10:30:00Z',
      categoryName: 'Consulta',
    },
    {
      id: 'e2',
      descricao: 'Material de escritorio',
      amountCents: 5000,
      kind: 'despesa',
      method: 'Dinheiro',
      paidAt: '2026-08-06T11:00:00Z',
      categoryName: 'Materiais',
    },
    {
      id: 'e3',
      descricao: 'Retorno — Joao Silva',
      amountCents: 15000,
      kind: 'receita',
      method: 'Cartao',
      paidAt: '2026-08-06T14:00:00Z',
      categoryName: 'Retorno',
    },
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
  const carregarDados = vi.fn(async () => DADOS);
  render(<FinanceiroCaixa carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroCaixa', () => {
  it('renderiza skeleton enquanto carrega', () => {
    render(
      <FinanceiroCaixa carregarDados={() => new Promise<CaixaDados>(() => {})} />,
    );
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renderiza tabela com dados', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Maria Souza/)).toBeVisible();
    expect(screen.getByText(/Material de escritorio/)).toBeVisible();
    expect(screen.getByText(/Joao Silva/)).toBeVisible();
  });

  it('ordena ao clicar no cabecalho de coluna', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    // Clica no cabecalho Valor para ordenar ascendente
    const thValor = screen.getByText('Valor').closest('th')!;
    await userEvent.click(thValor);
    expect(thValor.getAttribute('aria-sort')).toBe('ascending');

    // Clica novamente para ordenar descendente
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
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const selectCategoria = screen.getByLabelText('Categoria');
    await userEvent.selectOptions(selectCategoria, 'Consulta');

    // Apenas lancamentos da categoria Consulta devem ser visiveis
    expect(screen.getByText(/Maria Souza/)).toBeVisible();
    expect(
      screen.queryByText(/Material de escritorio/),
    ).not.toBeInTheDocument();
  });

  it('filtra por status', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const selectTipo = screen.getByLabelText('Tipo');
    await userEvent.selectOptions(selectTipo, 'receita');

    // Apenas receitas devem ser visiveis
    expect(screen.getByText(/Maria Souza/)).toBeVisible();
    expect(
      screen.queryByText(/Material de escritorio/),
    ).not.toBeInTheDocument();
  });

  it('mostra valores positivos em verde', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('+ R$ 250,00');
    expect(el.className).toContain('text-ok');
  });

  it('mostra valores negativos em vermelho', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('- R$ 50,00');
    expect(el.className).toContain('text-danger');
  });

  it('mostra estado vazio quando sem resultados', async () => {
    const dadosVazios: CaixaDados = { ...DADOS, lancamentos: [] };
    render(
      <FinanceiroCaixa carregarDados={async () => dadosVazios} />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Nenhum lancamento encontrado/),
      ).toBeVisible(),
    );
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroCaixa carregarDados={async () => DADOS} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
