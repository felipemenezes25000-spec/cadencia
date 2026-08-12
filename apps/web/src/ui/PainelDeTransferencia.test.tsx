import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PainelDeTransferencia, type ContaParaTransferir } from './PainelDeTransferencia';

const CONTAS: ContaParaTransferir[] = [
  { bankAccountId: 'c1', name: 'Conta corrente' },
  { bankAccountId: 'c2', name: 'Poupanca' },
  { bankAccountId: 'c3', name: 'Caixa fisico' },
];

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    contas: CONTAS,
    aoTransferir: vi.fn(async (_t: {
      fromBankAccountId: string; toBankAccountId: string;
      amountCents: number; description: string }) => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeTransferencia {...props} />);
  return props;
}

function preencher(de = 'c1', para = 'c2', valor = '500,00', desc = 'Reforco de caixa'): void {
  fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: de } });
  fireEvent.change(screen.getByLabelText(/^para$/i), { target: { value: para } });
  fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: valor } });
  fireEvent.change(screen.getByLabelText(/descri/i), { target: { value: desc } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeTransferencia', () => {
  it('não deixa transferir de uma conta para ela mesma', () => {
    montar();
    preencher('c1', 'c1');
    // Origem igual a destino gera dois lançamentos que se anulam e sujam o
    // extrato sem mover dinheiro nenhum.
    expect(screen.getByRole('button', { name: /transferir/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/mesma conta/i);
  });

  it('exige descrição — extrato sem histórico não concilia', () => {
    montar();
    preencher('c1', 'c2', '500,00', '');
    // Daqui a três meses, "transferência" sem motivo obriga alguém a caçar o
    // extrato do banco para lembrar o que foi.
    expect(screen.getByRole('button', { name: /transferir/i })).toBeDisabled();
  });

  it('valor zero não passa', () => {
    montar();
    preencher('c1', 'c2', '0,00');
    expect(screen.getByRole('button', { name: /transferir/i })).toBeDisabled();
  });

  it('entrega centavos inteiros', async () => {
    const { aoTransferir } = montar();
    preencher('c1', 'c2', '1.250,50');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /transferir/i }));
    });
    expect(aoTransferir).toHaveBeenCalledWith({
      fromBankAccountId: 'c1', toBankAccountId: 'c2',
      amountCents: 125050, description: 'Reforco de caixa',
    });
  });

  it('avisa que a transferência gera DOIS lançamentos', () => {
    montar();
    // Quem vê só o saldo mudar acha que sumiu dinheiro. A transferência debita
    // de um lado e credita do outro, e o extrato mostra os dois.
    expect(screen.getByText(/dois lançamentos/i)).toBeInTheDocument();
  });

  it('falha não apaga o que foi preenchido', async () => {
    montar({
      aoTransferir: vi.fn(async () => { throw new Error('fora do ar'); }),
    });
    preencher();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /transferir/i }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    expect(screen.getByLabelText(/valor/i)).toHaveValue('500,00');
  });

  it('sem duas contas cadastradas explica em vez de mostrar formulário vazio', () => {
    montar({ contas: [CONTAS[0]!] });
    // Formulário com um select de uma opção só é um beco sem saída silencioso.
    expect(screen.getByText(/cadastre pelo menos duas contas/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
  });
});
