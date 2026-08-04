import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ComboboxDePaciente, type PacienteHit } from './ComboboxDePaciente';

const HITS: PacienteHit[] = [
  { patientId: 'p1', displayName: 'MARIA SOUZA LIMA', legalName: 'Maria Souza Lima',
    hasSocialName: false, birthDate: '1988-03-14', cadastroStatus: 'completo',
    phonePrimary: '11987654321' },
  { patientId: 'p2', displayName: 'Joana Prado', legalName: 'Joao Prado',
    hasSocialName: true, birthDate: null, cadastroStatus: 'preliminar', phonePrimary: null },
];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function montar(buscar = vi.fn(async () => HITS), aoCriar = vi.fn(), aoEscolher = vi.fn()) {
  render(<ComboboxDePaciente buscar={buscar} aoEscolher={aoEscolher} aoCriar={aoCriar} />);
  return { buscar, aoCriar, aoEscolher };
}

async function digitar(texto: string) {
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: texto } });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
}

describe('combobox de busca de paciente', () => {
  it('tem os papeis ARIA de combobox com listbox', () => {
    montar();
    const input = screen.getByRole('combobox', { name: 'Buscar paciente' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('debounce de 120 ms: nao chama a busca a cada tecla', async () => {
    const { buscar } = montar();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'mar' } });
    fireEvent.change(input, { target: { value: 'mari' } });
    fireEvent.change(input, { target: { value: 'maria' } });
    expect(buscar).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('maria');
  });

  it('o nome SOCIAL fica em destaque e o civil aparece como secundario', async () => {
    montar();
    await digitar('joa');
    expect(screen.getByText('Joana Prado')).toBeVisible();
    expect(screen.getByText(/Joao Prado/)).toBeVisible();
  });

  it('"+ Criar" e SEMPRE a ultima linha, inclusive com resultados', async () => {
    montar();
    await digitar('maria');
    const opcoes = screen.getAllByRole('option');
    expect(opcoes).toHaveLength(3);
    expect(opcoes[2]).toHaveTextContent(/Criar “maria”/);
  });

  it('setas movem aria-activedescendant e Enter escolhe', async () => {
    const { aoEscolher } = montar();
    const input = screen.getByRole('combobox');
    await digitar('maria');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(aoEscolher).toHaveBeenCalledWith(HITS[0]);
  });

  it('Enter na ultima linha cria o paciente com o termo digitado', async () => {
    const { aoCriar } = montar();
    const input = screen.getByRole('combobox');
    await digitar('maria sou');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(aoCriar).toHaveBeenCalledWith('maria sou');
  });

  it('mostra o sinal de cadastro preliminar na linha', async () => {
    montar();
    await digitar('joa');
    expect(screen.getByText('cadastro preliminar')).toBeVisible();
  });

  it('sem violacao de acessibilidade com a lista aberta', async () => {
    const { container } = render(
      <ComboboxDePaciente buscar={async () => HITS} aoEscolher={vi.fn()} aoCriar={vi.fn()} />);
    await digitar('maria');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });
});
