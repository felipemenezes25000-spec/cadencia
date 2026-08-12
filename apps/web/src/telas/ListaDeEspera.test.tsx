import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ListaDeEspera } from './ListaDeEspera';

const ITENS = [
  { waitlistId: 'w1', patientId: 'p1', displayName: 'Maria Souza Lima',
    prioridade: 'alta' as const, esperandoDesde: '2026-07-20T12:00:00.000Z',
    observacao: 'quer manhã' },
  { waitlistId: 'w2', patientId: 'p2', displayName: 'Joana Prado',
    prioridade: 'normal' as const, esperandoDesde: '2026-07-25T12:00:00.000Z',
    observacao: null },
];

describe('lista de espera', () => {
  it('é painel lateral FIXO, não um modal que some ao clicar fora', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: 'Lista de espera' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza lista de pacientes', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('Joana Prado')).toBeVisible();
  });

  it('ordena por prioridade e depois por tempo de espera', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    const linhas = screen.getAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
  });

  it('mostra posição numérica', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByText('1')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
  });

  it('mostra alça de arraste', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Arrastar Maria Souza Lima/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Arrastar Joana Prado/ })).toBeVisible();
  });

  it('cada item tem alternativa de TECLADO ao arraste — arrastar não pode ser o único caminho', async () => {
    const aoChamar = vi.fn();
    render(<ListaDeEspera itens={ITENS} aoChamar={aoChamar} />);
    await userEvent.click(screen.getByRole('button', { name: /Chamar Joana Prado/ }));
    expect(aoChamar).toHaveBeenCalledWith('w2');
  });

  it('mostra botão Chamar', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Chamar/ })).toHaveLength(2);
  });

  it('mostra há quanto tempo a pessoa espera, em texto', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByText(/desde 20\/07/)).toBeVisible();
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
