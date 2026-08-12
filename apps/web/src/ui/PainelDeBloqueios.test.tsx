import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PainelDeBloqueios, type Bloqueio } from './PainelDeBloqueios';

const ALMOCO: Bloqueio = {
  blockId: '018f2b00-0000-7000-8000-000000000001',
  kind: 'almoco',
  motivo: 'Almoco',
  // Como a API responde DE VERDADE: o instante no fuso da sessão do Postgres,
  // que é UTC. O deslocamento da unidade não vem embutido — a rota só usa o
  // fuso da clínica para FILTRAR o intervalo, não para formatar a saída.
  startsAt: '2026-08-12T15:00:00+00:00',
  endsAt: '2026-08-12T16:00:00+00:00',
  professionalId: '018f2b00-0000-7000-8000-0000000000aa',
  professionalNome: 'Dra. Helena Prado',
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    dia: '2026-08-12',
    timezone: 'America/Sao_Paulo',
    bloqueios: [] as readonly Bloqueio[],
    profissionais: [
      { professionalId: '018f2b00-0000-7000-8000-0000000000aa', nome: 'Dra. Helena Prado' },
    ],
    aoCriar: vi.fn(async () => {}),
    aoRemover: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeBloqueios {...props} />);
  return props;
}

/** Preenche o formulário mínimo válido. */
function preencher(motivo = 'Almoco', inicio = '12:00', fim = '13:00'): void {
  fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: motivo } });
  fireEvent.change(screen.getByLabelText(/das/i), { target: { value: inicio } });
  fireEvent.change(screen.getByLabelText(/^até$/i), { target: { value: fim } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeBloqueios', () => {
  it('sem motivo não dá para bloquear', () => {
    montar();
    preencher('');
    // Bloqueio sem motivo vira buraco na agenda que ninguém sabe explicar — e
    // acaba sendo removido por engano por quem não sabe de quem era.
    expect(screen.getByRole('button', { name: /bloquear/i })).toBeDisabled();
  });

  it('recusa fim antes do início sem ir ao servidor', async () => {
    const { aoCriar } = montar();
    preencher('Cirurgia', '15:00', '14:00');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
    });
    expect(aoCriar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/termina antes de começar/i);
  });

  it('entrega hora de parede — quem converte o fuso é a página, não o painel', async () => {
    const { aoCriar } = montar();
    preencher('Almoco', '12:00', '13:00');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
    });
    // Se o painel chamasse `new Date(...).toISOString()` usaria o fuso do
    // NAVEGADOR: a recepcionista em casa, em outro estado, bloquearia a hora
    // errada na agenda da clínica.
    expect(aoCriar).toHaveBeenCalledWith(expect.objectContaining({
      inicioParede: '2026-08-12T12:00',
      fimParede: '2026-08-12T13:00',
      motivo: 'Almoco',
      kind: 'almoco',
    }));
  });

  it('sobreposição vira frase, não código de erro', async () => {
    montar({
      aoCriar: vi.fn(async () => {
        throw Object.assign(new Error('bloqueio_sobreposto'), { codigo: 'bloqueio_sobreposto' });
      }),
    });
    preencher('Almoco', '12:00', '13:00');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
    });
    expect(screen.getByRole('alert'))
      .toHaveTextContent(/já existe um bloqueio nesse horário/i);
  });

  it('lista mostra de quem é o bloqueio, na hora da clínica', () => {
    montar({ bloqueios: [ALMOCO] });
    const item = screen.getByRole('listitem');
    // "12:00-13:00 bloqueado" sem dono não diz à recepção se ela ainda pode
    // marcar com o OUTRO médico no mesmo horário.
    expect(item).toHaveTextContent(/dra\. helena prado/i);
    // O almoço foi marcado para as 12:00 em São Paulo e a API devolveu 15:00Z.
    // Mostrar 15:00 seria mostrar o relógio de Greenwich para quem está na
    // clínica — e a recepção marcaria consulta em cima do almoço.
    expect(item).toHaveTextContent('12:00');
    expect(item).toHaveTextContent('13:00');
    expect(item).not.toHaveTextContent('15:00');
  });

  it('remover exige confirmar', async () => {
    const { aoRemover } = montar({ bloqueios: [ALMOCO] });
    fireEvent.click(screen.getByRole('button', { name: /remover/i }));
    // Um clique errado liberaria a tarde inteira de um médico sem ninguém
    // perceber até a consulta ser marcada em cima.
    expect(aoRemover).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirmar remoção/i }));
    });
    expect(aoRemover).toHaveBeenCalledWith(ALMOCO.blockId);
  });
});
