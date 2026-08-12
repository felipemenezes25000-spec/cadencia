// apps/web/src/telas/PainelDeConversa.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeConversa, type Mensagem, type ContextoConversa } from './PainelDeConversa';

const MENSAGENS: Mensagem[] = [
  {
    messageId: 'm1', direction: 'inbound',
    body: 'Bom dia, confirmo a consulta de amanha',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered',
  },
  {
    messageId: 'm2', direction: 'outbound',
    body: 'Perfeito, Maria! Confirmado para amanha as 14h.',
    sentAt: '2026-08-03T14:31:00.000Z', deliveryStatus: 'read',
  },
  {
    messageId: 'm3', direction: 'outbound',
    body: 'Lembramos de trazer os exames.',
    sentAt: '2026-08-03T14:32:00.000Z', deliveryStatus: 'sent',
  },
];

const MENSAGENS_MULTI_DIA: Mensagem[] = [
  {
    messageId: 'd1', direction: 'inbound',
    body: 'Mensagem do dia 2',
    sentAt: '2026-08-02T10:00:00.000Z', deliveryStatus: 'delivered',
  },
  {
    messageId: 'd2', direction: 'outbound',
    body: 'Resposta do dia 3',
    sentAt: '2026-08-03T14:00:00.000Z', deliveryStatus: 'sent',
  },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: { dia: '2026-08-04', hora: '14:00', procedimento: 'Consulta' },
  pendencias: ['CPF', 'Endereco'],
  historicoAgendamentos: [
    { dia: '2026-07-01', procedimento: 'Retorno', status: 'atendido' },
  ],
};

function montar(over: Partial<Parameters<typeof PainelDeConversa>[0]> = {}) {
  const props = {
    conversationId: 'c1',
    nomeExibido: 'Maria Souza Lima',
    phoneNumber: '+5511999990001',
    patientId: 'p1' as string | null,
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoEnviar: vi.fn(async () => ({ messageId: 'm4' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<PainelDeConversa {...props} />);
  return props;
}

/* Guarda o scrollIntoView original para restaurar */
const scrollIntoViewOriginal = HTMLElement.prototype.scrollIntoView;

afterEach(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoViewOriginal;
});

describe('painel de conversa', () => {
  it('mostra o nome do contato no cabeçalho', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 2, name: /Maria Souza Lima/ })).toBeVisible());
  });

  it('mensagens inbound ficam à esquerda e outbound à direita', async () => {
    montar();
    const msgs = await screen.findAllByTestId(/^msg-/);
    expect(msgs[0]).toHaveAttribute('data-direction', 'inbound');
    expect(msgs[1]).toHaveAttribute('data-direction', 'outbound');
  });

  it('mostra status de entrega com ícones discretos nas mensagens outbound', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByTitle('Entregue')).toBeVisible();
      expect(screen.getByTitle('Lido')).toBeVisible();
      expect(screen.getByTitle('Enviado')).toBeVisible();
    });
  });

  it('Enter envia a mensagem, Shift+Enter quebra linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Ola!');
    await userEvent.keyboard('{Enter}');
    expect(aoEnviar).toHaveBeenCalledWith('Ola!');
  });

  it('Shift+Enter não envia, insere quebra de linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Linha 1');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('painel de contexto mostra próximo agendamento e pendências, NUNCA conteúdo clínico', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText(/CPF/)).toBeVisible();
      expect(screen.getByText(/Endereco/)).toBeVisible();
    });
    expect(screen.queryByText(/prontuario/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostico/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prescricao/i)).not.toBeInTheDocument();
  });

  it('conversa com número desconhecido mostra opção de vincular a paciente', async () => {
    montar({ patientId: null, nomeExibido: '+5511888880002' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular paciente/ })).toBeVisible());
  });

  it('botão de template abre seletor', async () => {
    const { aoSelecionarTemplate } = montar();
    await screen.findAllByTestId(/^msg-/);
    await userEvent.click(screen.getByRole('button', { name: /Template/ }));
    expect(aoSelecionarTemplate).toHaveBeenCalled();
  });

  it('mostra separadores de data entre grupos de mensagens', async () => {
    montar({ carregarMensagens: vi.fn(async () => MENSAGENS_MULTI_DIA) });
    const separadores = await screen.findAllByTestId('date-separator');
    // 2 datas distintas = 2 separadores
    expect(separadores).toHaveLength(2);
  });

  it('faz scroll para última mensagem ao carregar', async () => {
    const scrollMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollMock;
    montar();
    await screen.findAllByTestId(/^msg-/);
    expect(scrollMock).toHaveBeenCalled();
  });

  it('mostra botão voltar quando aoVoltar é fornecido', async () => {
    const aoVoltar = vi.fn();
    montar({ aoVoltar });
    await screen.findAllByTestId(/^msg-/);
    const botaoVoltar = screen.getByRole('button', { name: /Voltar/ });
    expect(botaoVoltar).toBeInTheDocument();
    await userEvent.click(botaoVoltar);
    expect(aoVoltar).toHaveBeenCalled();
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <PainelDeConversa conversationId="c1" nomeExibido="Maria Souza Lima"
        phoneNumber="+5511999990001" patientId="p1"
        carregarMensagens={async () => MENSAGENS} carregarContexto={async () => CONTEXTO}
        aoEnviar={async () => ({ messageId: 'm4' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId(/^msg-/).length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
