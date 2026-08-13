import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Hoje } from './Hoje';

const DIA = {
  contadores: { agendados: 3, confirmados: 1, aguardando: 1, atendidos: 0, faltas: 0 },
  fila: [
    { appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z', patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1', professionalNome: 'Dra. Helena Vasques', procedureNome: 'Consulta', procedureCor: null, operadoraNome: 'Unimed', status: 'aguardando' as const, encaixe: false, teleconsulta: false, primeiraVez: false, cadastroPreliminar: true, encounterId: null, mensagensNaoLidas: 2, pagamentoPendente: true },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z', patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1', professionalNome: 'Dra. Helena Vasques', procedureNome: 'Retorno', procedureCor: null, operadoraNome: null, status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true, cadastroPreliminar: false, encounterId: null, mensagensNaoLidas: 0, pagamentoPendente: false },
    { appointmentId: 'a3', startsAt: '2026-08-03T15:00:00.000Z', endsAt: '2026-08-03T15:30:00.000Z', patientId: 'p3', displayName: 'Carlos Mendes', professionalId: 'pr2', professionalNome: 'Dr. Rafael Andrade', procedureNome: 'Procedimento', procedureCor: null, operadoraNome: 'SulAmérica', status: 'confirmado' as const, encaixe: false, teleconsulta: false, primeiraVez: false, cadastroPreliminar: false, encounterId: null, mensagensNaoLidas: 0, pagamentoPendente: false },
  ],
};

const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1, resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(overrides: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', timezone: 'America/Sao_Paulo',
    carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoConfirmar: vi.fn(async () => {}),
    aoAbrirAtendimento: vi.fn(), aoAbrirPaciente: vi.fn(), aoMudarFiltro: vi.fn(),
    mensagensNaoLidasTotal: 5, aoMensagem: vi.fn(), aoCobrar: vi.fn(),
    ...overrides,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('cockpit Hoje', () => {
  it('preserva a geometria com skeleton enquanto carrega', () => {
    montar({ carregarDia: () => new Promise(() => {}), carregarPrecisaDeVoce: () => new Promise(() => {}) });
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('explica o dia e o estado operacional em dois segundos', async () => {
    montar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible();
    expect(screen.getByText(/Segunda-feira, 3 de agosto/i)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Resumo do dia' })).toHaveTextContent('3Hoje');
    expect(screen.getByRole('button', { name: /Enviar mensagem/ })).toHaveTextContent('(5)');
  });

  it('a fila mantém contexto e uma única CTA principal por estado', async () => {
    montar();
    const fluxo = await screen.findByRole('region', { name: 'Fluxo de hoje' });
    expect(within(fluxo).getAllByRole('listitem')).toHaveLength(3);
    expect(within(fluxo).getByText('Cadastro preliminar')).toBeVisible();
    expect(within(fluxo).getByText('Encaixe')).toBeVisible();
    expect(within(fluxo).getByText('Primeira vez')).toBeVisible();
    expect(within(fluxo).getByRole('button', { name: 'Iniciar para Maria Souza Lima' })).toBeVisible();
    expect(within(fluxo).getByRole('button', { name: 'Confirmar para Joana Prado' })).toBeVisible();
    expect(within(fluxo).getByRole('button', { name: 'Fazer check-in para Carlos Mendes' })).toBeVisible();
  });

  it('filtros operacionais vivem no fluxo, não nos KPIs', async () => {
    const { aoMudarFiltro } = montar();
    await userEvent.click(await screen.findByRole('button', { name: /Em espera 1/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('espera');
  });

  it('clique no paciente abre quick view sem tirar a recepção da fila', async () => {
    montar();
    const fluxo = await screen.findByRole('region', { name: 'Fluxo de hoje' });
    const nome = within(fluxo).getByText('Maria Souza Lima');
    await userEvent.click(nome.closest('button')!);
    expect(screen.getByRole('dialog', { name: 'Visão rápida do paciente' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir paciente' })).toBeVisible();
  });

  it('check-in só muda o estado depois que a persistência confirma', async () => {
    let resolve!: () => void;
    const aoCheckIn = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    montar({ aoCheckIn });
    const fluxo = await screen.findByRole('region', { name: 'Fluxo de hoje' });
    await userEvent.click(within(fluxo).getByRole('button', { name: 'Fazer check-in para Carlos Mendes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Concluir check-in' }));
    expect(within(fluxo).getByText('Confirmado')).toBeVisible();
    expect(within(fluxo).getAllByText('Aguardando')).toHaveLength(1);
    resolve();
    await waitFor(() => expect(within(fluxo).getAllByText('Aguardando')).toHaveLength(2));
  });

  it('confirmação de agenda comunica sucesso apenas após a API', async () => {
    const aoConfirmar = vi.fn(async () => {});
    montar({ aoConfirmar });
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar para Joana Prado' }));
    await waitFor(() => expect(aoConfirmar).toHaveBeenCalledWith('a2'));
    expect(screen.getByRole('status')).toHaveTextContent('Joana Prado foi confirmado');
  });

  it('atenção necessária e painel da unidade formam uma narrativa única', async () => {
    montar();
    expect(await screen.findByRole('region', { name: 'Atenção necessária' })).toHaveTextContent('10 itens precisam');
    const painel = screen.getByRole('complementary', { name: 'Painel da unidade' });
    expect(painel).toHaveTextContent('Agora');
    expect(painel).toHaveTextContent('Próximo');
    expect(painel).toHaveTextContent('Pendências');
  });

  it('mantém o fluxo antes do painel auxiliar em telas estreitas', async () => {
    montar();
    const fluxo = await screen.findByRole('region', { name: 'Fluxo de hoje' });
    const painel = screen.getByRole('complementary', { name: 'Painel da unidade' });

    expect(fluxo).toHaveClass('order-1');
    expect(painel).toHaveClass('order-2');
  });

  it('estado vazio explica o que aconteceu', async () => {
    montar({ carregarDia: vi.fn(async () => ({ contadores: { agendados: 0, confirmados: 0, aguardando: 0, atendidos: 0, faltas: 0 }, fila: [] })) });
    expect(await screen.findByText('Nenhum atendimento hoje')).toBeVisible();
    expect(screen.getByText(/sem atendimentos agendados/i)).toBeVisible();
  });

  it('não introduz violações automáticas de acessibilidade', async () => {
    const { container } = render(<Hoje {...{
      dia: '2026-08-03', timezone: 'America/Sao_Paulo', carregarDia: async () => DIA,
      carregarPrecisaDeVoce: async () => PRECISA, aoCheckIn: async () => {},
      aoConfirmar: async () => {}, aoAbrirAtendimento: vi.fn(), aoAbrirPaciente: vi.fn(),
      aoMudarFiltro: vi.fn(), mensagensNaoLidasTotal: 0, aoMensagem: vi.fn(), aoCobrar: vi.fn(),
    }} />);
    await screen.findByRole('region', { name: 'Fluxo de hoje' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
