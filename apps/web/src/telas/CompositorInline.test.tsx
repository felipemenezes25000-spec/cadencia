import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  CompositorInline,
  type CompositorInlineProps,
  type ProcedimentoOpcao,
  type ConvenioOpcao,
} from './CompositorInline';

// Polyfill para jsdom: Radix Popover depende de ResizeObserver
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }
});

const PROCEDIMENTOS: ProcedimentoOpcao[] = [
  { id: 'p1', nome: 'Consulta', duracaoMin: 30, maisFrequente: true },
  { id: 'p2', nome: 'Retorno', duracaoMin: 15, maisFrequente: false },
];

const CONVENIOS: ConvenioOpcao[] = [
  { nome: 'Unimed', ultimoDoPaciente: false },
  { nome: 'Particular', ultimoDoPaciente: true },
];

function propsBase(overrides?: Partial<CompositorInlineProps>): CompositorInlineProps {
  return {
    inicioIso: '2026-08-03T13:00:00.000Z',
    procedimentos: PROCEDIMENTOS,
    convenios: CONVENIOS,
    buscarPacientes: async () => [],
    aoCriarPaciente: vi.fn(),
    aoAgendar: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function digitarCombobox(texto: string) {
  const input = screen.getByRole('combobox', { name: /Quem/ });
  fireEvent.change(input, { target: { value: texto } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
}

describe('CompositorInline', () => {
  it('renderiza formulario quando aberto', () => {
    render(
      <CompositorInline {...propsBase({ aberto: true })}>
        <button>Abrir</button>
      </CompositorInline>,
    );
    expect(
      screen.getByRole('form', { name: 'Novo agendamento' }),
    ).toBeInTheDocument();
  });

  it('renderiza formulario inline sem popover quando children nao e fornecido', () => {
    render(<CompositorInline {...propsBase()} />);
    expect(
      screen.getByRole('form', { name: 'Novo agendamento' }),
    ).toBeInTheDocument();
    // Sem popover, nao ha dialog
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pre-preenche horario e data quando fornecidos', () => {
    render(<CompositorInline {...propsBase()} />);
    const campoData = screen.getByLabelText('Data') as HTMLInputElement;
    const campoHorario = screen.getByLabelText('Horario') as HTMLInputElement;
    expect(campoData.value).toBe('2026-08-03');
    expect(campoHorario.value).toBe('13:00');
  });

  it('valida campos obrigatorios', async () => {
    render(<CompositorInline {...propsBase()} />);
    vi.useRealTimers();
    const user = userEvent.setup();

    // Limpa os campos de data e horario para forcar erro
    const campoData = screen.getByLabelText('Data') as HTMLInputElement;
    const campoHorario = screen.getByLabelText('Horario') as HTMLInputElement;
    await user.clear(campoData);
    await user.clear(campoHorario);

    // Tenta submeter sem paciente
    await user.click(screen.getByRole('button', { name: /Salvar/ }));

    // Deve mostrar erro de paciente
    await waitFor(() => {
      expect(
        screen.getByText('Selecione um paciente'),
      ).toBeInTheDocument();
    });
  });

  it('chama aoAgendar ao submeter formulario valido', async () => {
    const aoAgendar = vi.fn(async () => {});
    const buscarPacientes = vi.fn(async () => [
      {
        patientId: 'abc',
        displayName: 'Maria',
        legalName: 'Maria',
        hasSocialName: false,
        birthDate: null,
        cadastroStatus: 'completo' as const,
        phonePrimary: null,
      },
    ]);

    render(
      <CompositorInline
        {...propsBase({ aoAgendar, buscarPacientes })}
      />,
    );

    // Seleciona paciente
    await digitarCombobox('Maria');
    vi.useRealTimers();
    const opts = screen.getAllByRole('option');
    await userEvent.click(opts[0]!);

    // Submete
    await userEvent.click(screen.getByRole('button', { name: /Salvar/ }));

    await waitFor(() => {
      expect(aoAgendar).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'abc',
          procedureId: 'p1',
          operadoraNome: 'Particular',
          encaixe: false,
        }),
      );
    });
  });

  it('chama aoFechar ao clicar Cancelar', async () => {
    const aoFechar = vi.fn();
    render(<CompositorInline {...propsBase({ aoFechar })} />);
    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('fecha ao pressionar Escape sem texto digitado', async () => {
    const aoFechar = vi.fn();
    render(<CompositorInline {...propsBase({ aoFechar })} />);
    vi.useRealTimers();
    await userEvent.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('pede confirmacao ao pressionar Escape com texto digitado', async () => {
    const aoFechar = vi.fn();
    render(<CompositorInline {...propsBase({ aoFechar })} />);

    await digitarCombobox('maria');
    vi.useRealTimers();
    await userEvent.keyboard('{Escape}');

    expect(
      screen.getByRole('alertdialog', { name: /Descartar/ }),
    ).toBeVisible();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it('submete ao pressionar Ctrl+Enter', async () => {
    const aoAgendar = vi.fn(async () => {});
    const buscarPacientes = vi.fn(async () => [
      {
        patientId: 'abc',
        displayName: 'Maria',
        legalName: 'Maria',
        hasSocialName: false,
        birthDate: null,
        cadastroStatus: 'completo' as const,
        phonePrimary: null,
      },
    ]);

    render(
      <CompositorInline
        {...propsBase({ aoAgendar, buscarPacientes })}
      />,
    );

    // Seleciona paciente
    await digitarCombobox('Maria');
    vi.useRealTimers();
    const opts = screen.getAllByRole('option');
    await userEvent.click(opts[0]!);

    // Pressiona Ctrl+Enter
    const form = screen.getByRole('form');
    fireEvent.keyDown(form, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(aoAgendar).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'abc',
          encaixe: false,
        }),
      );
    });
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(<CompositorInline {...propsBase()} />);
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });
});
