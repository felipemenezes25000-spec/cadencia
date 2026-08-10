import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PainelDeRecorrencia, type NovaRecorrencia, type ResultadoDaSerie,
} from './PainelDeRecorrencia';

const OK: ResultadoDaSerie = {
  criadas: [
    { quando: '2027-03-02T14:00', appointmentId: 'a1' },
    { quando: '2027-03-09T14:00', appointmentId: 'a2' },
  ],
  recusadas: [],
};

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    dia: '2027-03-02',
    pacienteNome: 'Marina Souza Prado',
    procedimentos: [
      { id: 'p1', nome: 'Fisioterapia', duracaoMin: 50 },
      { id: 'p2', nome: 'Consulta', duracaoMin: 30 },
    ],
    aoCriar: vi.fn(async (_r: NovaRecorrencia): Promise<ResultadoDaSerie> => OK),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeRecorrencia {...props} />);
  return props;
}

function preencher(hora = '14:00', ate = '2027-03-30'): void {
  fireEvent.change(screen.getByLabelText(/hora/i), { target: { value: hora } });
  fireEvent.change(screen.getByLabelText(/repetir at/i), { target: { value: ate } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeRecorrencia', () => {
  it('sem horizonte nao da para criar', () => {
    montar();
    fireEvent.change(screen.getByLabelText(/hora/i), { target: { value: '14:00' } });
    // Serie sem fim marcaria consulta para sempre. O horizonte e o que a
    // recepcao combina com o paciente: "doze sessoes, ate o fim de marco".
    expect(screen.getByRole('button', { name: /criar serie/i })).toBeDisabled();
  });

  it('entrega data e hora SEPARADAS, nunca um instante', async () => {
    const { aoCriar } = montar();
    preencher();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /criar serie/i }));
    });
    // "Toda terca as 14h" e compromisso com o relogio da CLINICA. Mandar
    // instante obrigaria o navegador a converter o fuso — e ele pode estar em
    // outro estado que a clinica.
    expect(aoCriar).toHaveBeenCalledWith(expect.objectContaining({
      primeiraData: '2027-03-02',
      hora: '14:00',
      horizonteAte: '2027-03-30',
      freq: 'semanal',
    }));
  });

  it('mostra quantas entraram depois de criar', async () => {
    montar();
    preencher();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /criar serie/i }));
    });
    expect(screen.getByText(/2 consultas marcadas/i)).toBeInTheDocument();
  });

  it('lista as ocorrencias RECUSADAS uma a uma', async () => {
    montar({
      aoCriar: vi.fn(async (_r: NovaRecorrencia): Promise<ResultadoDaSerie> => ({
        criadas: [{ quando: '2027-03-02T14:00', appointmentId: 'a1' }],
        recusadas: [
          { quando: '2027-03-09T14:00', motivo: 'horario_ocupado' },
          { quando: '2027-03-16T14:00', motivo: 'sala_ocupada' },
        ],
      })),
    });
    preencher();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /criar serie/i }));
    });
    // Recusar em silencio deixaria o paciente achando que tem consulta num dia
    // em que nao tem. Cada dia que faltou aparece, com o motivo.
    expect(screen.getByText(/09\/03/)).toBeInTheDocument();
    expect(screen.getByText(/16\/03/)).toBeInTheDocument();
    expect(screen.getByText(/horario ocupado/i)).toBeInTheDocument();
    expect(screen.getByText(/sala ocupada/i)).toBeInTheDocument();
  });

  it('previa diz quantas consultas a serie vai gerar, antes de criar', () => {
    montar();
    preencher('14:00', '2027-03-30');
    // Quem combina com o paciente precisa saber se sao cinco ou cinquenta antes
    // de apertar o botao — nao depois de a agenda encher.
    expect(screen.getByText(/5 consultas/i)).toBeInTheDocument();
  });

  it('serie longa demais avisa na previa, sem ir ao servidor', async () => {
    const { aoCriar } = montar();
    fireEvent.change(screen.getByLabelText(/frequ/i), { target: { value: 'diaria' } });
    preencher('08:00', '2030-01-01');
    expect(screen.getByRole('alert')).toHaveTextContent(/limite/i);
    expect(screen.getByRole('button', { name: /criar serie/i })).toBeDisabled();
    expect(aoCriar).not.toHaveBeenCalled();
  });
});
