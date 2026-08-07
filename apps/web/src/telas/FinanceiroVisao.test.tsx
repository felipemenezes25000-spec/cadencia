// apps/web/src/telas/FinanceiroVisao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { FinanceiroVisao, type FinanceiroVisaoProps } from './FinanceiroVisao';

const DADOS: FinanceiroVisaoProps['dados'] = {
  receitaVsDespesa: [
    { mes: '2026-06', receita: 320000, despesa: 180000 },
    { mes: '2026-07', receita: 280000, despesa: 190000 },
    { mes: '2026-08', receita: 350000, despesa: 170000 },
  ],
  saldoProjetado: [
    { dia: '2026-08-01', saldo: 150000 },
    { dia: '2026-08-07', saldo: 180000 },
    { dia: '2026-08-14', saldo: 210000 },
    { dia: '2026-08-21', saldo: 250000 },
    { dia: '2026-08-28', saldo: 300000 },
  ],
  topCategorias: [
    { nome: 'Consulta', total: 200000, percentual: 57 },
    { nome: 'Retorno', total: 80000, percentual: 23 },
    { nome: 'Exame', total: 40000, percentual: 11 },
    { nome: 'Procedimento', total: 20000, percentual: 6 },
    { nome: 'Outros', total: 10000, percentual: 3 },
  ],
  alertas: [
    { tipo: 'a-receber-vencido', mensagem: '3 lancamentos vencidos ha mais de 30 dias', severidade: 'danger' },
    { tipo: 'estoque-baixo', mensagem: 'Luva P abaixo do minimo (5 unidades)', severidade: 'warn' },
  ],
  resumoMes: {
    receitaTotal: 350000,
    despesaTotal: 170000,
    saldo: 180000,
  },
};

function montar() {
  const carregarDados = vi.fn(async () => DADOS);
  render(<FinanceiroVisao carregarDados={carregarDados} />);
  return { carregarDados };
}

describe('FinanceiroVisao', () => {
  it('exibe o resumo do mes com receita, despesa e saldo formatados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(screen.getByText('R$ 1.700,00')).toBeVisible();
    expect(screen.getByText('R$ 1.800,00')).toBeVisible();
  });

  it('renderiza o grafico de receita vs despesa como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Receita vs despesa/i })).toBeVisible());
  });

  it('renderiza o grafico de saldo projetado como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /Saldo projetado/i })).toBeVisible());
  });

  it('exibe a secao top 5 categorias com nomes e percentuais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(screen.getByText('57%')).toBeVisible();
    expect(screen.getByText('Retorno')).toBeVisible();
  });

  it('exibe os alertas com a mensagem e indicador de severidade', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByText(/3 lancamentos vencidos/)).toBeVisible());
    expect(screen.getByText(/Luva P abaixo do minimo/)).toBeVisible();
  });

  it('valores monetarios usam font-variant-numeric tabular-nums', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    const el = screen.getByText('R$ 3.500,00');
    expect(el.className).toContain('num');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroVisao carregarDados={async () => DADOS} />,
    );
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
