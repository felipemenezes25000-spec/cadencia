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
      cadastroPreliminar: true, encounterId: null,
      mensagensNaoLidas: 2, pagamentoPendente: true },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z',
      patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1',
      procedureNome: 'Retorno', procedureCor: '#2f5fd0', operadoraNome: null,
      status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true,
      cadastroPreliminar: false, encounterId: null,
      mensagensNaoLidas: 0, pagamentoPendente: false },
  ],
};
const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1,
                  resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', timezone: 'America/Sao_Paulo', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    aoMudarFiltro: vi.fn(),
    mensagensNaoLidasTotal: 5,
    aoMensagem: vi.fn(), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('tela Hoje', () => {
  it('renderiza skeleton enquanto carrega', () => {
    render(
      <Hoje
        dia="2026-08-03" timezone="America/Sao_Paulo"
        carregarDia={() => new Promise(() => {})}
        carregarPrecisaDeVoce={() => new Promise(() => {})}
        aoCheckIn={vi.fn(async () => {})}
        aoAbrirAtendimento={vi.fn()}
        aoMudarFiltro={vi.fn()}
        mensagensNaoLidasTotal={0}
        aoMensagem={vi.fn()}
        aoCobrar={vi.fn()}
      />,
    );
    // Skeleton components renderizam com role="status"
    const skeletons = screen.getAllByRole('status');
    expect(skeletons.length).toBeGreaterThan(0);
    // Nao deve renderizar o titulo real durante carregamento
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('renderiza titulo e data por extenso apos carregar', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible(),
    );
    expect(screen.getByText(/segunda-feira, 3 de agosto/i)).toBeVisible();
  });

  it('mostra badge de mensagens nao-lidas no cabecalho', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByLabelText('5 mensagens não lidas')).toBeVisible(),
    );
  });

  it('NAO mostra badge quando nao ha mensagens nao-lidas', async () => {
    montar({ mensagensNaoLidasTotal: 0 });
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeVisible(),
    );
    expect(screen.queryByLabelText(/mensagens não lidas/)).not.toBeInTheDocument();
  });

  it('mostra a faixa de contadores e a fila em ordem de horario', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible(),
    );
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
    expect(linhas[1]).toHaveTextContent('Joana Prado');
  });

  it('clicar num contador vira query string, nao estado local', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible(),
    );
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('aguardando');
  });

  it('a linha mostra os sinais: cadastro preliminar, 1a vez e encaixe', async () => {
    montar();
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent(/cadastro preliminar/i);
    expect(linhas[1]).toHaveTextContent(/1.?\s*vez/i);
    expect(linhas[1]).toHaveTextContent(/encaixe/i);
  });

  it('check-in e otimista: o chip muda antes da resposta', async () => {
    const aoCheckIn = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoCheckIn });
    const linhas = await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /Check-in de Joana Prado/ }));
    expect(linhas[1]).toHaveTextContent(/Aguardando/);
  });

  it('acao Mensagem aparece para todos os pacientes e mostra contagem se > 0', async () => {
    const { aoMensagem } = montar();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }),
      ).toBeVisible(),
    );
    expect(
      screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }),
    ).toHaveTextContent('Mensagem (2)');
    expect(
      screen.getByRole('button', { name: /Mensagem para Joana Prado/ }),
    ).toHaveTextContent('Mensagem');
    await userEvent.click(
      screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }),
    );
    expect(aoMensagem).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('acao Cobrar aparece SOMENTE para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole('button', { name: /Cobrar Joana Prado/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ }),
    );
    expect(aoCobrar).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('o painel Precisa de voce lista as pendencias com numeros', async () => {
    montar();
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Precisa de você' }),
      ).toBeVisible(),
    );
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText(/confirmações sem resposta/i)).toBeVisible();
  });

  it('renderiza estado vazio quando sem agendamentos', async () => {
    montar({
      carregarDia: vi.fn(async () => ({
        contadores: { agendados: 0, confirmados: 0, aguardando: 0, atendidos: 0, faltas: 0 },
        fila: [],
      })),
    });
    await waitFor(() =>
      expect(screen.getByText('Nenhum agendamento hoje')).toBeVisible(),
    );
    expect(screen.getByText('Sua agenda esta livre!')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Novo agendamento/ }),
    ).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Hoje
        dia="2026-08-03" timezone="America/Sao_Paulo"
        carregarDia={async () => DIA}
        carregarPrecisaDeVoce={async () => PRECISA}
        aoCheckIn={async () => {}}
        aoAbrirAtendimento={vi.fn()}
        aoMudarFiltro={vi.fn()}
        mensagensNaoLidasTotal={0}
        aoMensagem={vi.fn()}
        aoCobrar={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
