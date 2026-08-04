import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Hoje } from './Hoje';

const DIA = {
  contadores: { agendados: 3, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 0 },
  fila: [
    { appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
      patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
      procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
      status: 'aguardando' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
      cadastroPreliminar: true, encounterId: null },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z',
      patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1',
      procedureNome: 'Retorno', procedureCor: '#2f5fd0', operadoraNome: null,
      status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true,
      cadastroPreliminar: false, encounterId: null },
  ],
};
const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1,
                  resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(), ...over,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('tela Hoje', () => {
  it('o titulo diz o dia por extenso — a tela e o relogio, nao um modulo', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Hoje, segunda-feira, 3 de agosto/i })).toBeVisible());
  });

  it('mostra a faixa de contadores e a fila em ordem de horario', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
    expect(linhas[1]).toHaveTextContent('Joana Prado');
  });

  it('clicar num contador vira query string, nao estado local', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('aguardando');
  });

  it('a linha mostra os sinais: cadastro preliminar, 1a vez e encaixe', async () => {
    montar();
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('cadastro preliminar');
    expect(linhas[1]).toHaveTextContent('1ª vez');
    expect(linhas[1]).toHaveTextContent('encaixe');
  });

  it('check-in e otimista: o chip muda antes da resposta', async () => {
    const aoCheckIn = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoCheckIn });
    const linhas = await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /Check-in de Joana Prado/ }));
    expect(linhas[1]).toHaveTextContent(/Aguardando/);
  });

  it('o painel Precisa de voce lista as cinco filas com os numeros', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Precisa de você' })).toBeVisible());
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText(/confirmações sem resposta/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Hoje dia="2026-08-03" carregarDia={async () => DIA}
        carregarPrecisaDeVoce={async () => PRECISA} aoCheckIn={async () => {}}
        aoAbrirAtendimento={vi.fn()} aoMudarFiltro={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
