import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { RegrasDeRepasse, type RegraDeRepasse } from './RegrasDeRepasse';

const PROFISSIONAIS = [
  { professionalId: 'p1', nome: 'Dra. Helena Vasques' },
  { professionalId: 'p2', nome: 'Dr. Rafael Andrade' },
];

const REGRAS: RegraDeRepasse[] = [
  { id: 'r1', professionalId: 'p1', procedureId: null, conventionName: null,
    percentage: 60, fixedAmountCents: null, priority: 1, active: true },
  { id: 'r2', professionalId: 'p1', procedureId: null,
    conventionName: 'Meridiano Saude', percentage: null,
    fixedAmountCents: 12000, priority: 2, active: true },
];

function montar(over: Record<string, unknown> = {}) {
  const props = {
    regras: REGRAS,
    profissionais: PROFISSIONAIS,
    aoCriar: vi.fn(async () => {}),
    ...over,
  };
  render(<RegrasDeRepasse {...props} />);
  return props;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('RegrasDeRepasse', () => {
  it('mostra a regra em linguagem de gente, nao em colunas de banco', () => {
    montar();
    const linhas = screen.getAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent(/60%/);
    expect(linhas[0]).toHaveTextContent(/dra\. helena vasques/i);
    // Valor fixo e percentual sao formatos diferentes e a tela precisa mostrar
    // qual e qual — R$ 120,00 e 120% seriam o mesmo numero na tela errada.
    expect(linhas[1]).toHaveTextContent(/R\$\s*120,00/);
  });

  it('regra sem convenio vale para todos — e a tela diz isso', () => {
    montar();
    // `null` em `conventionName` significa "qualquer convenio". Deixar a celula
    // vazia faria parecer cadastro incompleto.
    expect(screen.getAllByRole('listitem')[0])
      .toHaveTextContent(/qualquer convenio/i);
  });

  it('a prioridade e visivel — e ela que decide qual regra ganha', () => {
    montar();
    const linhas = screen.getAllByRole('listitem');
    // Duas regras podem casar com o mesmo atendimento. Sem ver a prioridade,
    // ninguem entende por que o repasse saiu 60% e nao R$ 120,00.
    expect(within(linhas[0]!).getByText(/prioridade 1/i)).toBeInTheDocument();
    expect(within(linhas[1]!).getByText(/prioridade 2/i)).toBeInTheDocument();
  });

  it('exige percentual OU valor fixo, nunca os dois', async () => {
    const { aoCriar } = montar();
    fireEvent.change(screen.getByLabelText(/profissional/i), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText(/percentual/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/valor fixo/i), { target: { value: '100,00' } });
    // Os dois preenchidos e ambiguidade pura: o backend teria de escolher, e
    // qualquer escolha dele surpreende quem cadastrou.
    expect(screen.getByRole('button', { name: /adicionar regra/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/um dos dois/i);
    expect(aoCriar).not.toHaveBeenCalled();
  });

  it('cria regra por percentual', async () => {
    const { aoCriar } = montar();
    fireEvent.change(screen.getByLabelText(/profissional/i), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText(/percentual/i), { target: { value: '55' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar regra/i }));
    });
    expect(aoCriar).toHaveBeenCalledWith({
      professionalId: 'p2', percentage: 55, priority: 1,
    });
  });

  it('valor fixo vai em centavos inteiros', async () => {
    const { aoCriar } = montar();
    fireEvent.change(screen.getByLabelText(/profissional/i), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText(/valor fixo/i), { target: { value: '120,00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /adicionar regra/i }));
    });
    expect(aoCriar).toHaveBeenCalledWith(expect.objectContaining({
      fixedAmountCents: 12000,
    }));
  });

  it('percentual acima de 100 nao passa', () => {
    montar();
    fireEvent.change(screen.getByLabelText(/profissional/i), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText(/percentual/i), { target: { value: '150' } });
    // Repassar 150% do que entrou faria a clinica pagar para atender.
    expect(screen.getByRole('button', { name: /adicionar regra/i })).toBeDisabled();
  });

  it('sem regra nenhuma explica o efeito, nao mostra lista vazia', () => {
    montar({ regras: [] });
    expect(screen.getByText(/nenhum repasse sera calculado/i)).toBeInTheDocument();
  });
});
