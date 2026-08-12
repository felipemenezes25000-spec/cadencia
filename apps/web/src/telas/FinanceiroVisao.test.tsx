// apps/web/src/telas/FinanceiroVisao.test.tsx
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { FinanceiroVisao, type VisaoDados } from './FinanceiroVisao';

// -- Mock ResizeObserver (necessário para visx ParentSize em jsdom) ----------

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        // Simula dimensões para o ParentSize
        this.cb(
          [
            {
              target,
              contentRect: { width: 600, height: 256, top: 0, left: 0, bottom: 256, right: 600, x: 0, y: 0, toJSON: () => ({}) },
              borderBoxSize: [{ inlineSize: 600, blockSize: 256 }],
              contentBoxSize: [{ inlineSize: 600, blockSize: 256 }],
              devicePixelContentBoxSize: [{ inlineSize: 600, blockSize: 256 }],
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    };
  }
});

// -- Dados de teste ---------------------------------------------------------

const DADOS: VisaoDados = {
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
    {
      tipo: 'a-receber-vencido',
      mensagem: '3 lancamentos vencidos ha mais de 30 dias',
      severidade: 'danger',
    },
    {
      tipo: 'estoque-baixo',
      mensagem: 'Luva P abaixo do minimo (5 unidades)',
      severidade: 'warn',
    },
  ],
  resumoMes: {
    receitaTotal: 350000,
    despesaTotal: 170000,
    saldo: 180000,
    pendente: 45000,
    variacaoReceita: 12.5,
    variacaoDespesa: -5.3,
  },
};

// -- Helper para montar com NuqsTestingAdapter ------------------------------

function montar(dadosOverride?: Partial<VisaoDados>) {
  const dadosFinal = dadosOverride ? { ...DADOS, ...dadosOverride } : DADOS;
  const carregarDados = vi.fn(async () => dadosFinal);
  const onUrlUpdate = vi.fn();

  const result = render(
    <NuqsTestingAdapter searchParams={{ periodo: 'mes' }} onUrlUpdate={onUrlUpdate} hasMemory>
      <FinanceiroVisao carregarDados={carregarDados} />
    </NuqsTestingAdapter>,
  );

  return { carregarDados, onUrlUpdate, ...result };
}

// -- Testes -----------------------------------------------------------------

describe('FinanceiroVisao', () => {
  it('renderiza skeleton enquanto carrega', () => {
    const carregarDados = vi.fn(() => new Promise<VisaoDados>(() => {})); // nunca resolve
    render(
      <NuqsTestingAdapter searchParams={{ periodo: 'mes' }}>
        <FinanceiroVisao carregarDados={carregarDados} />
      </NuqsTestingAdapter>,
    );
    expect(screen.getByTestId('financeiro-visao-skeleton')).toBeInTheDocument();
  });

  it('renderiza 4 cards de resumo', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita')).toBeVisible());
    expect(screen.getByText('Despesa')).toBeVisible();
    expect(screen.getByText('Saldo')).toBeVisible();
    expect(screen.getByText('Pendente')).toBeVisible();
  });

  it('mostra valores formatados em Real (R$)', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(screen.getByText('R$ 1.700,00')).toBeVisible();
    expect(screen.getByText('R$ 1.800,00')).toBeVisible();
    expect(screen.getByText('R$ 450,00')).toBeVisible(); // pendente
  });

  it('mostra variação percentual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/12\.5% vs\. período anterior/)).toBeVisible());
    expect(screen.getByText(/5\.3% vs\. período anterior/)).toBeVisible();
  });

  it('renderiza seletor de período', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita')).toBeVisible());
    expect(screen.getByRole('group', { name: /Seletor de período/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Diário' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Semanal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mensal' })).toBeVisible();
  });

  it('muda período ao clicar', async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = montar();
    await waitFor(() => expect(screen.getByText('Receita')).toBeVisible());

    await user.click(screen.getByRole('button', { name: 'Diário' }));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: expect.stringContaining('periodo=dia'),
        }),
      );
    });
  });

  it('renderiza gráfico de receita', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita')).toBeVisible());
    expect(screen.getByTestId('grafico-receita')).toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = montar();
    await waitFor(() => expect(screen.getByText('R$ 3.500,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
