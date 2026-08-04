import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Pacientes, FACETAS } from './Pacientes';

const HITS = [
  { patientId: 'p1', displayName: 'Álvaro Neto', legalName: 'Álvaro Neto',
    hasSocialName: false, birthDate: '1970-01-01', cadastroStatus: 'completo' as const,
    phonePrimary: null },
  { patientId: 'p2', displayName: 'Ana Lima', legalName: 'Ana Lima', hasSocialName: false,
    birthDate: null, cadastroStatus: 'preliminar' as const, phonePrimary: '11999999999' },
];

describe('tela Pacientes', () => {
  it('as abas do lider viram FACETAS, que sao filtros salvos', () => {
    expect(FACETAS.map((f) => f.chave)).toEqual([
      'ativos', 'inativos', 'obitos', 'cadastro_preliminar', 'sem_retorno']);
  });

  it('a faceta escolhida vai para a query string', async () => {
    const aoMudarFaceta = vi.fn();
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={aoMudarFaceta} aoAbrir={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cadastro preliminar' }));
    expect(aoMudarFaceta).toHaveBeenCalledWith('cadastro_preliminar');
  });

  it('lista em ordem portuguesa: Álvaro antes de Ana', async () => {
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    const linhas = screen.getAllByRole('row');
    expect(linhas[1]).toHaveTextContent('Álvaro Neto');
    expect(linhas[2]).toHaveTextContent('Ana Lima');
  });

  it('marca o cadastro preliminar com texto, nunca so com cor', async () => {
    render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('preliminar')).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Pacientes buscar={async () => HITS} faceta="ativos"
      aoMudarFaceta={vi.fn()} aoAbrir={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
