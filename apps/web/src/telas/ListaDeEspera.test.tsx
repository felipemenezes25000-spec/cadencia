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
  it('e painel lateral FIXO, nao um modal que some ao clicar fora', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: 'Lista de espera' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ordena por prioridade e depois por tempo de espera', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    const linhas = screen.getAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
  });

  it('cada item tem alternativa de TECLADO ao arraste — arrastar nao pode ser o unico caminho', async () => {
    const aoChamar = vi.fn();
    render(<ListaDeEspera itens={ITENS} aoChamar={aoChamar} />);
    await userEvent.click(screen.getByRole('button', { name: /Chamar Joana Prado/ }));
    expect(aoChamar).toHaveBeenCalledWith('w2');
  });

  it('mostra ha quanto tempo a pessoa espera, em texto', () => {
    render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(screen.getByText(/desde 20\/07/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ListaDeEspera itens={ITENS} aoChamar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
