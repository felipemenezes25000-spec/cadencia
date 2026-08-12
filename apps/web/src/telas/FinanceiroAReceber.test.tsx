// apps/web/src/telas/FinanceiroAReceber.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

const HOJE = '2026-08-06';

const DADOS: AReceberDados = {
  total: 100000,
  entradas: [
    {
      id: 'e1',
      patientName: 'Maria Souza',
      description: 'Consulta',
      amountCents: 25000,
      dueDate: '2026-08-10',
      daysPastDue: 0,
      categoryName: 'Consulta',
    },
    {
      id: 'e2',
      patientName: 'Joao Silva',
      description: 'Retorno',
      amountCents: 50000,
      dueDate: '2026-07-15',
      daysPastDue: 22,
      categoryName: 'Retorno',
    },
    {
      id: 'e3',
      patientName: 'Ana Costa',
      description: 'Exame',
      amountCents: 30000,
      dueDate: '2026-07-01',
      daysPastDue: 36,
      categoryName: 'Exame',
    },
    {
      id: 'e4',
      patientName: 'Carlos Lima',
      description: 'Ajuste credito',
      amountCents: -5000,
      dueDate: '2026-08-05',
      daysPastDue: 0,
      categoryName: 'Ajuste',
    },
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
  it('renderiza skeleton enquanto carrega', () => {
    render(
      <FinanceiroAReceber
        carregarDados={() => new Promise<AReceberDados>(() => {})}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('explica falha de carregamento e oferece nova tentativa', async () => {
    const carregarDados = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(DADOS);
    render(
      <FinanceiroAReceber
        carregarDados={carregarDados}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    expect(await screen.findByText('Não foi possível carregar as contas a receber')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('table')).toBeVisible();
  });

  it('renderiza tabela com dados', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
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
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    const de = screen.getByLabelText('De');
    fireEvent.change(de, { target: { value: '2026-07-20' } });

    // e1 dueDate 2026-08-10 >= 2026-07-20 -> visível
    // e2 dueDate 2026-07-15 < 2026-07-20 -> oculto
    // e3 dueDate 2026-07-01 < 2026-07-20 -> oculto
    // e4 dueDate 2026-08-05 >= 2026-07-20 -> visível
    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeVisible();
      expect(screen.queryByText('Joao Silva')).not.toBeInTheDocument();
    });
  });

  it('filtra por categoria', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    const selectCategoria = screen.getByLabelText('Categoria');
    await userEvent.selectOptions(selectCategoria, 'Consulta');

    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.queryByText('Joao Silva')).not.toBeInTheDocument();
  });

  it('filtra por status', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );

    const selectStatus = screen.getByLabelText('Status');
    await userEvent.selectOptions(selectStatus, 'pendente');

    // e1 daysPastDue=0 -> pendente, e4 daysPastDue=0 -> pendente
    // e2 daysPastDue=22 -> vencido, e3 daysPastDue=36 -> vencido
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('Carlos Lima')).toBeVisible();
    expect(screen.queryByText('Joao Silva')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana Costa')).not.toBeInTheDocument();
  });

  it('mostra valores positivos em verde', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('R$ 250,00');
    expect(el.className).toContain('text-ok');
  });

  it('mostra valores negativos em vermelho', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    const el = screen.getByText('R$ -50,00');
    expect(el.className).toContain('text-danger');
  });

  it('mostra estado vazio quando sem resultados', async () => {
    const dadosVazios: AReceberDados = { ...DADOS, entradas: [] };
    render(
      <FinanceiroAReceber
        carregarDados={async () => dadosVazios}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
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
      <FinanceiroAReceber
        carregarDados={async () => DADOS}
        aoCobrar={async () => {}}
        aoMarcarPago={async () => {}}
        aoEnviarLink={async () => {}}
        hoje={HOJE}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
