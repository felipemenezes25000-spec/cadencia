// apps/web/src/telas/ConveniosOperadoras.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosOperadoras,
  type Operadora,
  type OperadorasDados,
} from './ConveniosOperadoras';

const OPERADORAS: readonly Operadora[] = [
  {
    id: 'op1', nome: 'Unimed', registroAns: '123456',
    versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
    email: 'faturamento@unimed.com.br', telefone: '(11) 3333-4444',
    ativa: true, totalPacientes: 42,
  },
  {
    id: 'op2', nome: 'Bradesco Saude', registroAns: '654321',
    versaoTiss: '4.01.00', cnpj: 'XY9876543210ZW',
    email: 'tiss@bradescosaude.com.br', telefone: '(11) 5555-6666',
    ativa: true, totalPacientes: 18,
  },
  {
    id: 'op3', nome: 'SulAmerica', registroAns: '111222',
    versaoTiss: '3.05.00', cnpj: 'SA1111222233CD',
    email: null, telefone: null,
    ativa: false, totalPacientes: 0,
  },
];

const DADOS: OperadorasDados = { operadoras: OPERADORAS };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoSalvar: vi.fn(async (_op: Partial<Operadora> & { nome: string; registroAns: string }) => {}),
    aoDesativar: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosOperadoras {...props} />);
  return props;
}

describe('ConveniosOperadoras', () => {
  it('lista as operadoras com nome, registro ANS e status', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText('SulAmerica')).toBeVisible();
    expect(screen.getByText('123456')).toBeVisible();
  });

  it('exibe a versao TISS acordada de cada operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('4.01.00')).toBeVisible();
  });

  it('exibe o total de pacientes vinculados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/42 paciente/i)).toBeVisible();
  });

  it('operadoras inativas tem indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('SulAmerica')).toBeVisible());
    const linha = screen.getByText('SulAmerica').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Inativa/i)).toBeVisible();
  });

  it('tem botao para criar nova operadora', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible());
  });

  it('ao clicar em Nova operadora abre formulario', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByRole('dialog', { name: /Nova operadora/i })).toBeVisible();
  });

  it('formulario exige nome e registro ANS', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByLabelText(/^Nome/i)).toBeVisible();
    expect(screen.getByLabelText(/Registro ANS/i)).toBeVisible();
    expect(screen.getByLabelText(/Versao TISS/i)).toBeVisible();
  });

  it('cada operadora ativa tem botao Desativar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Desativar/i })).toBeVisible();
  });

  it('ao clicar Desativar chama aoDesativar com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Desativar/i }));
    expect(props.aoDesativar).toHaveBeenCalledWith('op1');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosOperadoras
        carregarDados={async () => DADOS}
        aoSalvar={async () => {}}
        aoDesativar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
