import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { CadastrosFinanceiros, type DadosDosCadastros } from './CadastrosFinanceiros';

const DADOS: DadosDosCadastros = {
  fornecedores: [
    { supplierId: 'f1', name: 'Imobiliaria Central', cnpj: '11222333000181',
      phone: null, active: true },
    { supplierId: 'f2', name: 'Papelaria Antiga', cnpj: null, phone: null,
      active: false },
  ],
  contas: [
    { bankAccountId: 'c1', name: 'Conta corrente', bankCode: '341',
      agency: '1234', accountNumber: '56789-0', initialBalanceCents: 250000,
      active: true },
  ],
  centrosDeCusto: [
    { costCenterId: 'cc1', name: 'Administrativo', code: 'ADM', active: true },
  ],
  recorrencias: [
    { recurringId: 'r1', description: 'Aluguel', amountCents: 850000,
      kind: 'despesa', frequency: 'monthly', dayOfMonth: 5, active: true },
  ],
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    dados: DADOS,
    aoCriarFornecedor: vi.fn(async () => {}),
    aoCriarConta: vi.fn(async () => {}),
    aoCriarCentroDeCusto: vi.fn(async () => {}),
    aoRemoverRecorrencia: vi.fn(async () => {}),
    ...over,
  };
  render(<CadastrosFinanceiros {...props} />);
  return props;
}

/**
 * Radix ativa a aba no `mouseDown`, não no `click` — quem só dispara click vê o
 * conteúdo antigo e conclui que a tela não troca de aba.
 */
async function irPara(aba: RegExp): Promise<void> {
  const alvo = screen.getByRole('tab', { name: aba });
  await act(async () => {
    fireEvent.mouseDown(alvo);
    fireEvent.click(alvo);
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('CadastrosFinanceiros', () => {
  it('abre em fornecedores — é o cadastro que o a-pagar exige', () => {
    montar();
    // Lançar uma despesa sem fornecedor cadastrado é o beco em que a clínica
    // esbarra primeiro. A aba útil fica na frente.
    expect(screen.getByRole('tab', { name: /fornecedor/i }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Imobiliaria Central')).toBeInTheDocument();
  });

  it('inativo aparece marcado, não sumido', () => {
    montar();
    // Fornecedor inativo continua ligado a despesas antigas. Some-lo da lista
    // faria parecer que a despesa aponta para o nada.
    const linha = screen.getByText('Papelaria Antiga').closest('li')!;
    expect(within(linha).getByText(/inativo/i)).toBeInTheDocument();
  });

  it('cria fornecedor só com o nome — CNPJ vem depois', async () => {
    const { aoCriarFornecedor } = montar();
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Nova Grafica' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar fornecedor/i }));
    });
    // Exigir CNPJ na hora faria quem está com a nota na mão inventar número.
    expect(aoCriarFornecedor).toHaveBeenCalledWith({ name: 'Nova Grafica' });
  });

  it('conta bancária exige banco, agência e número', async () => {
    const { aoCriarConta } = montar();
    await irPara(/conta/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Poupanca' } });
    // Conta sem agência não serve para conciliar extrato — que é a única razão
    // de a conta existir no sistema.
    expect(screen.getByRole('button', { name: /adicionar conta/i })).toBeDisabled();
    expect(aoCriarConta).not.toHaveBeenCalled();
  });

  it('saldo inicial vai em centavos inteiros', async () => {
    const { aoCriarConta } = montar();
    await irPara(/conta/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Poupanca' } });
    fireEvent.change(screen.getByLabelText(/banco/i), { target: { value: '104' } });
    fireEvent.change(screen.getByLabelText(/agência/i), { target: { value: '0001' } });
    fireEvent.change(screen.getByLabelText(/número/i), { target: { value: '12345-6' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '1.250,50' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar conta/i }));
    });
    expect(aoCriarConta).toHaveBeenCalledWith(expect.objectContaining({
      initialBalanceCents: 125050,
    }));
  });

  it('centro de custo tem código, e ele vira maiúscula', async () => {
    const { aoCriarCentroDeCusto } = montar();
    await irPara(/centro/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Marketing' } });
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'mkt' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar centro/i }));
    });
    // Código é o que aparece no relatório contábil. Misturar 'mkt' e 'MKT'
    // criaria dois centros que a contabilidade lê como o mesmo.
    expect(aoCriarCentroDeCusto).toHaveBeenCalledWith({ name: 'Marketing', code: 'MKT' });
  });

  it('recorrência mostra o que vai lançar e quando', async () => {
    montar();
    await irPara(/recorr/i);
    const linha = screen.getByRole('listitem');
    expect(linha).toHaveTextContent('Aluguel');
    expect(linha).toHaveTextContent(/R\$\s*8\.500,00/);
    expect(linha).toHaveTextContent(/dia 5/i);
  });

  it('remover recorrência pede confirmação', async () => {
    const { aoRemoverRecorrencia } = montar();
    await irPara(/recorr/i);
    fireEvent.click(screen.getByRole('button', { name: /remover/i }));
    // Apagar a recorrência do aluguel sem querer faria a despesa sumir do
    // fluxo de caixa, e ninguém notaria até o mês fechar errado.
    expect(aoRemoverRecorrencia).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    });
    expect(aoRemoverRecorrencia).toHaveBeenCalledWith('r1');
  });
});
