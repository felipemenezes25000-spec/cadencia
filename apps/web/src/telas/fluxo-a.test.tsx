import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompositorInline } from './CompositorInline';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function digitarCombobox(texto: string) {
  const input = screen.getByRole('combobox', { name: /Quem/ });
  fireEvent.change(input, { target: { value: texto } });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
}

describe('fluxo critico (a) — recepcionista agenda paciente novo, com ele na linha', () => {
  it('o compositor e INLINE: nao existe dialog de pagina cheia', () => {
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z" procedimentos={[]}
      convenios={[]} buscarPacientes={async () => []}
      aoCriarPaciente={vi.fn()} aoAgendar={vi.fn()} aoFechar={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Novo agendamento' })).toBeInTheDocument();
  });

  it('o foco ja esta no campo "Quem" ao abrir', () => {
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z"
      procedimentos={[]} convenios={[]} buscarPacientes={async () => []}
      aoCriarPaciente={vi.fn()} aoAgendar={vi.fn()} aoFechar={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: /Quem/ })).toHaveFocus();
  });

  it('Esc com texto digitado pede confirmacao antes de fechar', async () => {
    const aoFechar = vi.fn();
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z" procedimentos={[]}
      convenios={[]} buscarPacientes={async () => []}
      aoCriarPaciente={vi.fn()} aoAgendar={vi.fn()} aoFechar={aoFechar} />);
    await digitarCombobox('maria');
    vi.useRealTimers();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: /Descartar/ })).toBeVisible();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it('conflito de horario oferece "Encaixar mesmo assim", nao um erro seco', async () => {
    const aoAgendar = vi.fn(async () => { throw { codigo: 'horario_ocupado' }; });
    render(<CompositorInline inicioIso="2026-08-03T13:00:00.000Z"
      procedimentos={[{ id: 'p', nome: 'C', duracaoMin: 30, maisFrequente: true }]}
      convenios={[{ nome: 'Particular', ultimoDoPaciente: true }]}
      buscarPacientes={async () => [{ patientId: 'p1', displayName: 'Maria',
        legalName: 'Maria', hasSocialName: false, birthDate: null,
        cadastroStatus: 'completo' as const, phonePrimary: null }]}
      aoCriarPaciente={vi.fn()} aoAgendar={aoAgendar} aoFechar={vi.fn()} />);
    await digitarCombobox('maria');
    vi.useRealTimers();
    const opts = screen.getAllByRole('option');
    await userEvent.click(opts[0]!);
    await userEvent.click(screen.getByRole('button', { name: /Salvar/ }));
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Encaixar mesmo assim/ })).toBeVisible());
  });
});
