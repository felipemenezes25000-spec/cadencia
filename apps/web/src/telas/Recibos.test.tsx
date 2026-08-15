import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { Recibos, type RecibosProps } from './Recibos';

const LISTA = [
  { receiptNumber: 42, patientName: 'Maria Souza Lima', description: 'Consulta',
    amountCents: 25000, method: 'dinheiro' as const, paidAt: '2026-08-03T13:30:00.000Z',
    receiptId: 'r1' },
  { receiptNumber: 43, patientName: 'Joana Prado', description: 'Retorno',
    amountCents: 15000, method: 'pix' as const, paidAt: '2026-08-03T14:00:00.000Z',
    receiptId: 'r2' },
];

/** Wrapper com TooltipProvider exigido pelo Radix. */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={0}>{children}</RadixTooltip.Provider>
  );
}

function montar(overrides?: Partial<RecibosProps>) {
  const props: RecibosProps = {
    carregarRecibos: vi.fn(async (_filtros: { dataInicio?: string; dataFim?: string; paciente?: string }) => LISTA),
    aoImprimirRecibo: vi.fn(async () => {}),
    ...overrides,
  };
  render(<Recibos {...props} />, { wrapper: Wrapper });
  return props;
}

describe('tela Recibos', () => {
  it('exibe o título "Recibos" como h2, abaixo do h1 da seção', async () => {
    /* Nivel 2 de proposito: FinanceiroLayout monta o <h1> "Financeiro" e esta
       tela e uma aba dentro dele. Como h1, a pagina saia com dois. */
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 2, name: /Recibos/ })).toBeVisible());
  });

  it('renderiza tabela de recibos', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const tabela = screen.getByRole('table');
    expect(tabela).toBeVisible();
    expect(screen.getByText('Número')).toBeVisible();
    // "Paciente" aparece tanto no filtro quanto no cabeçalho da tabela
    const cabecalhos = screen.getAllByRole('columnheader');
    expect(cabecalhos.some((th) => th.textContent === 'Paciente')).toBe(true);
    expect(screen.getByText('Valor')).toBeVisible();
  });

  it('lista os recibos com número sequencial, paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('R$ 250,00')).toBeVisible();
  });

  it('cada recibo tem botão "Imprimir"', async () => {
    const props = montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Imprimir/ }).length).toBe(2));
    await userEvent.click(screen.getAllByRole('button', { name: /Imprimir/ })[0]!);
    expect(props.aoImprimirRecibo).toHaveBeenCalledWith('r1');
  });

  it('mostra botões imprimir e email', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(screen.getAllByRole('button', { name: /Imprimir/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /e-mail/i })).toHaveLength(2);
  });

  it('tem campos de filtro por data e paciente', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data inicial/i)).toBeVisible());
    expect(screen.getByLabelText(/Data final/i)).toBeVisible();
    expect(screen.getByLabelText(/Paciente/i)).toBeVisible();
  });

  it('filtra por busca', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoBusca = screen.getByLabelText(/Buscar/i);
    await userEvent.type(campoBusca, 'Joana');
    await waitFor(() => {
      expect(screen.queryByText('Maria Souza Lima')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Joana Prado')).toBeVisible();
  });

  it('filtra por data', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoDataInicio = screen.getByLabelText(/Data inicial/i);
    await userEvent.type(campoDataInicio, '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    expect(props.carregarRecibos).toHaveBeenCalledTimes(2);
  });

  it('ao preencher filtro de paciente e disparar busca, recarrega a lista', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoPaciente = screen.getByLabelText(/Paciente/i);
    await userEvent.type(campoPaciente, 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    expect(props.carregarRecibos).toHaveBeenCalledTimes(2);
  });

  it('mostra skeleton enquanto carrega', () => {
    render(
      <Wrapper>
        <Recibos
          carregarRecibos={() => new Promise(() => {})}
          aoImprimirRecibo={async () => {}}
        />
      </Wrapper>,
    );
    expect(screen.getByTestId('skeleton-recibos')).toBeVisible();
  });

  it('mostra estado vazio', async () => {
    render(
      <Wrapper>
        <Recibos
          carregarRecibos={async () => []}
          aoImprimirRecibo={async () => {}}
        />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText('Nenhum recibo encontrado')).toBeVisible(),
    );
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <Wrapper>
        <Recibos
          carregarRecibos={async () => LISTA}
          aoImprimirRecibo={async () => {}}
        />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
