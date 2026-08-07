// apps/web/src/telas/FinanceiroEstoque.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroEstoque, type EstoqueDados } from './FinanceiroEstoque';

const DADOS: EstoqueDados = {
  produtos: [
    { id: 'pr1', nome: 'Luva P', quantidade: 5, minimo: 20, unidade: 'cx',
      ultimaMovimentacao: '2026-08-05', alertaBaixo: true },
    { id: 'pr2', nome: 'Seringa 10ml', quantidade: 150, minimo: 50, unidade: 'un',
      ultimaMovimentacao: '2026-08-04', alertaBaixo: false },
    { id: 'pr3', nome: 'Gaze esteril', quantidade: 30, minimo: 40, unidade: 'pct',
      ultimaMovimentacao: '2026-08-03', alertaBaixo: true },
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
  it('lista os produtos com nome, quantidade e unidade', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(screen.getByText('Seringa 10ml')).toBeVisible();
    expect(screen.getByText('Gaze esteril')).toBeVisible();
  });

  it('exibe a quantidade atual e o minimo de cada produto', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('5 cx')).toBeVisible());
    expect(screen.getByText('150 un')).toBeVisible();
    expect(screen.getByText('30 pct')).toBeVisible();
  });

  it('destaca produtos com estoque abaixo do minimo com indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    const linhaLuva = screen.getByText('Luva P').closest('li');
    expect(linhaLuva).toBeTruthy();
    expect(linhaLuva!.getAttribute('data-alerta')).toBe('baixo');
  });

  it('produtos acima do minimo nao tem indicador de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Seringa 10ml')).toBeVisible());
    const linhaSeringa = screen.getByText('Seringa 10ml').closest('li');
    expect(linhaSeringa).toBeTruthy();
    expect(linhaSeringa!.getAttribute('data-alerta')).toBe('ok');
  });

  it('exibe o historico de movimentacoes recentes', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Movimentacoes recentes/i })).toBeVisible());
    expect(screen.getByText(/saida/i)).toBeVisible();
    expect(screen.getByText(/entrada/i)).toBeVisible();
  });

  it('movimentacao mostra produto, tipo, quantidade, data e responsavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Maria/)).toBeVisible());
    expect(screen.getByText(/Joao/)).toBeVisible();
  });

  it('tem botao para registrar nova movimentacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova movimentacao/i })).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroEstoque
        carregarDados={async () => DADOS}
        aoRegistrarMovimentacao={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Luva P')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
