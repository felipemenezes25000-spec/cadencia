// apps/web/src/telas/FinanceiroEstoque.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroEstoque, type EstoqueDados } from './FinanceiroEstoque';

const DADOS: EstoqueDados = {
  produtos: [
    { id: 'pr1', nome: 'Luva P', quantidade: 5, minimo: 20, unidade: 'cx',
      ultimaMovimentacao: '2026-08-05', alertaBaixo: true, categoria: 'EPI' },
    { id: 'pr2', nome: 'Seringa 10ml', quantidade: 150, minimo: 50, unidade: 'un',
      ultimaMovimentacao: '2026-08-04', alertaBaixo: false, categoria: 'Insumos' },
    { id: 'pr3', nome: 'Gaze esteril', quantidade: 30, minimo: 40, unidade: 'pct',
      ultimaMovimentacao: '2026-08-03', alertaBaixo: true, categoria: 'Insumos' },
  ],
  movimentacoes: [
    { id: 'm1', produtoNome: 'Luva P', tipo: 'saida', quantidade: 10,
      data: '2026-08-05', responsavel: 'Maria' },
    { id: 'm2', produtoNome: 'Seringa 10ml', tipo: 'entrada', quantidade: 100,
      data: '2026-08-04', responsavel: 'Joao' },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoRegistrarMovimentacao: vi.fn(async () => {}),
  };
  render(<FinanceiroEstoque {...props} />);
  return props;
}

describe('FinanceiroEstoque', () => {
  it('renderiza skeleton enquanto carrega', () => {
    render(
      <FinanceiroEstoque
        carregarDados={() => new Promise(() => {})}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    expect(screen.getByLabelText('Carregando estoque...')).toBeInTheDocument();
  });

  it('renderiza tabela de produtos', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Produtos em estoque/i });
    expect(secao).toBeVisible();
    expect(within(secao).getByText('Luva P')).toBeVisible();
    expect(within(secao).getByText('Seringa 10ml')).toBeVisible();
    expect(within(secao).getByText('Gaze esteril')).toBeVisible();
  });

  it('destaca produtos com estoque baixo', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Produtos em estoque/i });
    // Verifica o data-alerta na linha do produto
    const linhaLuva = within(secao).getByText('Luva P').closest('tr');
    expect(linhaLuva).toBeTruthy();
    expect(linhaLuva!.getAttribute('data-alerta')).toBe('baixo');
    // Verifica badge "Estoque baixo"
    expect(within(secao).getAllByText('Estoque baixo').length).toBeGreaterThan(0);
    // Produto OK não tem alerta
    const linhaSeringa = within(secao).getByText('Seringa 10ml').closest('tr');
    expect(linhaSeringa!.getAttribute('data-alerta')).toBe('ok');
  });

  it('filtra ao digitar na busca', async () => {
    const user = userEvent.setup();
    montar();
    const secao = await screen.findByRole('region', { name: /Produtos em estoque/i });

    const campoBusca = screen.getByLabelText('Buscar produto');
    await user.type(campoBusca, 'Seringa');

    // Seringa deve continuar visível
    expect(within(secao).getByText('Seringa 10ml')).toBeVisible();
    // Luva e Gaze devem sumir da tabela de produtos
    expect(within(secao).queryByText('Luva P')).not.toBeInTheDocument();
    expect(within(secao).queryByText('Gaze esteril')).not.toBeInTheDocument();
  });

  it('filtra por categoria', async () => {
    const user = userEvent.setup();
    montar();
    const secao = await screen.findByRole('region', { name: /Produtos em estoque/i });

    const selectCategoria = screen.getByLabelText('Filtrar por categoria');
    await user.selectOptions(selectCategoria, 'EPI');

    // Luva é EPI, deve continuar visível
    expect(within(secao).getByText('Luva P')).toBeVisible();
    // Seringa e Gaze são Insumos, devem sumir da tabela
    expect(within(secao).queryByText('Seringa 10ml')).not.toBeInTheDocument();
    expect(within(secao).queryByText('Gaze esteril')).not.toBeInTheDocument();
  });

  it('filtra apenas estoque baixo', async () => {
    const user = userEvent.setup();
    montar();
    const secao = await screen.findByRole('region', { name: /Produtos em estoque/i });

    const checkbox = screen.getByLabelText('Apenas estoque baixo');
    await user.click(checkbox);

    // Luva e Gaze têm estoque baixo, devem continuar
    expect(within(secao).getByText('Luva P')).toBeVisible();
    expect(within(secao).getByText('Gaze esteril')).toBeVisible();
    // Seringa não tem estoque baixo, deve sumir
    expect(within(secao).queryByText('Seringa 10ml')).not.toBeInTheDocument();
  });

  it('exibe o histórico de movimentações recentes', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Movimentações recentes/i })).toBeVisible());
  });

  it('tem botão para registrar nova movimentação', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova movimentação/i })).toBeVisible());
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroEstoque
        carregarDados={async () => DADOS}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    await screen.findByRole('region', { name: /Produtos em estoque/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
