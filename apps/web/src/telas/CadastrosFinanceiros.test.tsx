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
 * Radix ativa a aba no `mouseDown`, nao no `click` — quem so dispara click ve o
 * conteudo antigo e conclui que a tela nao troca de aba.
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
  it('abre em fornecedores — e o cadastro que o a-pagar exige', () => {
    montar();
    // Lancar uma despesa sem fornecedor cadastrado e o beco em que a clinica
    // esbarra primeiro. A aba util fica na frente.
    expect(screen.getByRole('tab', { name: /fornecedor/i }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Imobiliaria Central')).toBeInTheDocument();
  });

  it('inativo aparece marcado, nao sumido', () => {
    montar();
    // Fornecedor inativo continua ligado a despesas antigas. Some-lo da lista
    // faria parecer que a despesa aponta para o nada.
    const linha = screen.getByText('Papelaria Antiga').closest('li')!;
    expect(within(linha).getByText(/inativo/i)).toBeInTheDocument();
  });

  it('cria fornecedor so com o nome — CNPJ vem depois', async () => {
    const { aoCriarFornecedor } = montar();
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Nova Grafica' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar fornecedor/i }));
    });
    // Exigir CNPJ na hora faria quem esta com a nota na mao inventar numero.
    expect(aoCriarFornecedor).toHaveBeenCalledWith({ name: 'Nova Grafica' });
  });

  it('conta bancaria exige banco, agencia e numero', async () => {
    const { aoCriarConta } = montar();
    await irPara(/conta/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Poupanca' } });
    // Conta sem agencia nao serve para conciliar extrato — que e a unica razao
    // de a conta existir no sistema.
    expect(screen.getByRole('button', { name: /adicionar conta/i })).toBeDisabled();
    expect(aoCriarConta).not.toHaveBeenCalled();
  });

  it('saldo inicial vai em centavos inteiros', async () => {
    const { aoCriarConta } = montar();
    await irPara(/conta/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Poupanca' } });
    fireEvent.change(screen.getByLabelText(/banco/i), { target: { value: '104' } });
    fireEvent.change(screen.getByLabelText(/agencia/i), { target: { value: '0001' } });
    fireEvent.change(screen.getByLabelText(/numero/i), { target: { value: '12345-6' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '1.250,50' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar conta/i }));
    });
    expect(aoCriarConta).toHaveBeenCalledWith(expect.objectContaining({
      initialBalanceCents: 125050,
    }));
  });

  it('centro de custo tem codigo, e ele vira maiuscula', async () => {
    const { aoCriarCentroDeCusto } = montar();
    await irPara(/centro/i);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Marketing' } });
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: 'mkt' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar centro/i }));
    });
    // Codigo e o que aparece no relatorio contabil. Misturar 'mkt' e 'MKT'
    // criaria dois centros que a contabilidade le como o mesmo.
    expect(aoCriarCentroDeCusto).toHaveBeenCalledWith({ name: 'Marketing', code: 'MKT' });
  });

  it('recorrencia mostra o que vai lancar e quando', async () => {
    montar();
    await irPara(/recorr/i);
    const linha = screen.getByRole('listitem');
    expect(linha).toHaveTextContent('Aluguel');
    expect(linha).toHaveTextContent(/R\$\s*8\.500,00/);
    expect(linha).toHaveTextContent(/dia 5/i);
  });

  it('remover recorrencia pede confirmacao', async () => {
    const { aoRemoverRecorrencia } = montar();
    await irPara(/recorr/i);
    fireEvent.click(screen.getByRole('button', { name: /remover/i }));
    // Apagar a recorrencia do aluguel sem querer faria a despesa sumir do
    // fluxo de caixa, e ninguem notaria ate o mes fechar errado.
    expect(aoRemoverRecorrencia).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    });
    expect(aoRemoverRecorrencia).toHaveBeenCalledWith('r1');
  });
});
