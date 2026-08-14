import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PainelDeTeleconsulta, type DadosTeleconsulta } from './PainelDeTeleconsulta';

const TELECONSULTA: DadosTeleconsulta = {
  id: 'tc-1',
  roomUrl: 'https://meet.jit.si/cadencia-test-room',
  roomId: 'cadencia-test-room',
  provider: 'jitsi',
  endedAt: null,
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    teleconsulta: null as DadosTeleconsulta | null,
    aoIniciar: vi.fn(async () => TELECONSULTA),
    aoEncerrar: vi.fn(async () => {}),
    ...over,
  };
  render(<PainelDeTeleconsulta {...props} />);
  return props;
}

describe('PainelDeTeleconsulta', () => {
  it('renders initiate button when no teleconsulta', () => {
    montar();
    expect(screen.getByRole('button', { name: /iniciar teleconsulta/i })).toBeDefined();
    expect(screen.getByTestId('status-teleconsulta').textContent).toBe('Aguardando');
  });

  it('creates teleconsulta on click', async () => {
    const props = montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /iniciar teleconsulta/i }));
    });
    expect(props.aoIniciar).toHaveBeenCalledOnce();
    expect(screen.getByTestId('status-teleconsulta').textContent).toBe('Em andamento');
  });

  it('shows iframe after creation', async () => {
    montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /iniciar teleconsulta/i }));
    });
    expect(screen.getByTitle('Teleconsulta')).toBeDefined();
  });

  it('shows end button when in progress', async () => {
    montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /iniciar teleconsulta/i }));
    });
    expect(screen.getByRole('button', { name: /encerrar teleconsulta/i })).toBeDefined();
  });

  it('calls aoEncerrar and shows encerrada status', async () => {
    const props = montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /iniciar teleconsulta/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /encerrar teleconsulta/i }));
    });
    expect(props.aoEncerrar).toHaveBeenCalledWith('tc-1');
    expect(screen.getByTestId('status-teleconsulta').textContent).toBe('Encerrada');
  });

  it('shows ended status when teleconsulta already ended', () => {
    montar({ teleconsulta: { ...TELECONSULTA, endedAt: '2026-01-01T00:00:00.000Z' } });
    expect(screen.getByTestId('status-teleconsulta').textContent).toBe('Encerrada');
    expect(screen.getByText(/esta teleconsulta foi encerrada/i)).toBeDefined();
  });

  it('shows open room button when teleconsulta exists but iframe not open', () => {
    montar({ teleconsulta: TELECONSULTA });
    expect(screen.getByRole('button', { name: /abrir sala/i })).toBeDefined();
    expect(screen.getByTestId('status-teleconsulta').textContent).toBe('Em andamento');
  });

  it('opens iframe when clicking open room', async () => {
    montar({ teleconsulta: TELECONSULTA });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /abrir sala/i }));
    });
    expect(screen.getByTitle('Teleconsulta')).toBeDefined();
  });

  it('shows error on initiation failure', async () => {
    montar({ aoIniciar: vi.fn(async () => { throw new Error('fail'); }) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /iniciar teleconsulta/i }));
    });
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível criar');
  });
});
