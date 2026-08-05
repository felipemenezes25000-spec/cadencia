// apps/web/src/telas/Conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Confirmo',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Oi',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Confirmo',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

function montar(over: Partial<Parameters<typeof Conversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    conversaAbertaId: null as string | null,
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    aoEnviar: vi.fn(async () => ({ messageId: 'm9' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<Conversas {...props} />);
  return props;
}

describe('tela Conversas (split view)', () => {
  it('sem conversa selecionada, mostra so a lista', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('textbox', { name: /Mensagem/ })).not.toBeInTheDocument();
  });

  it('layout e split 40/60 quando uma conversa esta aberta', async () => {
    montar({ conversaAbertaId: 'c1' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Mensagem/ })).toBeVisible());
    const container = screen.getByTestId('split-view');
    expect(container).toHaveStyle({ gridTemplateColumns: '40% 60%' });
  });

  it('clicar na conversa chama aoAbrirConversa', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('conversa com numero desconhecido mostra o numero e botao de vincular no painel', async () => {
    montar({ conversaAbertaId: 'c2' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    expect(screen.getAllByText('+5511888880002').length).toBeGreaterThanOrEqual(1);
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Conversas filtro="todas" conversaAbertaId="c1"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
