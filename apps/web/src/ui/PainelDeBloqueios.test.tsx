import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PainelDeBloqueios, type Bloqueio } from './PainelDeBloqueios';

const ALMOCO: Bloqueio = {
  blockId: '018f2b00-0000-7000-8000-000000000001',
  kind: 'almoco',
  motivo: 'Almoco',
  // Como a API responde DE VERDADE: o instante no fuso da sessao do Postgres,
  // que e UTC. O deslocamento da unidade nao vem embutido — a rota so usa o
  // fuso da clinica para FILTRAR o intervalo, nao para formatar a saida.
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

/** Preenche o formulario minimo valido. */
function preencher(motivo = 'Almoco', inicio = '12:00', fim = '13:00'): void {
  fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: motivo } });
  fireEvent.change(screen.getByLabelText(/das/i), { target: { value: inicio } });
  fireEvent.change(screen.getByLabelText(/^ate$/i), { target: { value: fim } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeBloqueios', () => {
  it('sem motivo nao da para bloquear', () => {
    montar();
    preencher('');
    // Bloqueio sem motivo vira buraco na agenda que ninguem sabe explicar — e
    // acaba sendo removido por engano por quem nao sabe de quem era.
    expect(screen.getByRole('button', { name: /bloquear/i })).toBeDisabled();
  });

  it('recusa fim antes do inicio sem ir ao servidor', async () => {
    const { aoCriar } = montar();
    preencher('Cirurgia', '15:00', '14:00');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
    });
    expect(aoCriar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/termina antes de comecar/i);
  });

  it('entrega hora de parede — quem converte o fuso e a pagina, nao o painel', async () => {
    const { aoCriar } = montar();
    preencher('Almoco', '12:00', '13:00');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
    });
    // Se o painel chamasse `new Date(...).toISOString()` usaria o fuso do
    // NAVEGADOR: a recepcionista em casa, em outro estado, bloquearia a hora
    // errada na agenda da clinica.
    expect(aoCriar).toHaveBeenCalledWith(expect.objectContaining({
      inicioParede: '2026-08-12T12:00',
      fimParede: '2026-08-12T13:00',
      motivo: 'Almoco',
      kind: 'almoco',
    }));
  });

  it('sobreposicao vira frase, nao codigo de erro', async () => {
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
      .toHaveTextContent(/ja existe um bloqueio nesse horario/i);
  });

  it('lista mostra de quem e o bloqueio, na hora da clinica', () => {
    montar({ bloqueios: [ALMOCO] });
    const item = screen.getByRole('listitem');
    // "12:00-13:00 bloqueado" sem dono nao diz a recepcao se ela ainda pode
    // marcar com o OUTRO medico no mesmo horario.
    expect(item).toHaveTextContent(/dra\. helena prado/i);
    // O almoco foi marcado para as 12:00 em Sao Paulo e a API devolveu 15:00Z.
    // Mostrar 15:00 seria mostrar o relogio de Greenwich para quem esta na
    // clinica — e a recepcao marcaria consulta em cima do almoco.
    expect(item).toHaveTextContent('12:00');
    expect(item).toHaveTextContent('13:00');
    expect(item).not.toHaveTextContent('15:00');
  });

  it('remover exige confirmar', async () => {
    const { aoRemover } = montar({ bloqueios: [ALMOCO] });
    fireEvent.click(screen.getByRole('button', { name: /remover/i }));
    // Um clique errado liberaria a tarde inteira de um medico sem ninguem
    // perceber ate a consulta ser marcada em cima.
    expect(aoRemover).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirmar remocao/i }));
    });
    expect(aoRemover).toHaveBeenCalledWith(ALMOCO.blockId);
  });
});
