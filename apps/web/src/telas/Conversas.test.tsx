// apps/web/src/telas/Conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

/* ── Dados de teste ───────────────────────────────────────────────────── */

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1',
    patientId: 'p1',
    patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001',
    lastMessageBody: 'Confirmo',
    lastMessageAt: '2026-08-03T14:30:00.000Z',
    unreadCount: 1,
    channel: 'whatsapp',
    status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2',
    patientId: null,
    patientName: null,
    phoneNumber: '+5511888880002',
    lastMessageBody: 'Oi',
    lastMessageAt: '2026-08-03T13:00:00.000Z',
    unreadCount: 0,
    channel: 'whatsapp',
    status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  {
    messageId: 'm1',
    direction: 'inbound',
    body: 'Confirmo',
    sentAt: '2026-08-03T14:30:00.000Z',
    deliveryStatus: 'delivered',
  },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null,
  pendencias: [],
  historicoAgendamentos: [],
};

/* ── Função auxiliar de montagem ───────────────────────────────────────── */

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
    aoVoltar: vi.fn(),
    aoNova: vi.fn(),
    ...over,
  };
  const result = render(<Conversas {...props} />);
  return { ...props, ...result };
}

/* ── Testes ────────────────────────────────────────────────────────────── */

describe('Conversas (split view)', () => {
  it('renderiza skeleton enquanto carrega', () => {
    montar({
      carregarConversas: vi.fn(() => new Promise<ConversaResumo[]>(() => {})),
    });
    expect(screen.getByTestId('conversas-skeleton')).toBeInTheDocument();
  });

  it('renderiza lista de conversas no painel esquerdo', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );
    expect(screen.getByText('+5511888880002')).toBeVisible();
  });

  it('mostra estado vazio quando nenhuma conversa selecionada', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );
    expect(
      screen.getByText('Sua central de relacionamento'),
    ).toBeVisible();
  });

  it('mostra conversa ao selecionar da lista', async () => {
    montar({ conversaAbertaId: 'c1' });
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: /Mensagem/ }),
      ).toBeVisible(),
    );
  });

  it('campo de busca filtra conversas', async () => {
    const user = userEvent.setup();
    montar();

    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );

    const campoBusca = screen.getByPlaceholderText('Paciente, telefone ou mensagem…');
    await user.type(campoBusca, 'Maria');

    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.queryByText('+5511888880002')).not.toBeInTheDocument();
  });

  it('botão Nova chama aoNova', async () => {
    const user = userEvent.setup();
    const { aoNova } = montar();

    await waitFor(() =>
      expect(screen.getByText('Maria Souza Lima')).toBeVisible(),
    );

    await user.click(screen.getByRole('button', { name: /Nova/ }));
    expect(aoNova).toHaveBeenCalledTimes(1);
  });

  it('clicar na conversa chama aoAbrirConversa', async () => {
    const user = userEvent.setup();
    const { aoAbrirConversa } = montar();

    const itens = await screen.findAllByRole('listitem');
    const botoes = await screen.findAllByRole('button');
    await user.click(itens[0]!);
    await user.click(botoes.find((b) => b.textContent?.includes('Maria Souza Lima'))!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('conversa com número desconhecido mostra botão de vincular no painel', async () => {
    montar({ conversaAbertaId: 'c2' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Vincular paciente/ }),
      ).toBeVisible(),
    );
    expect(screen.getAllByText('+5511888880002').length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = montar({ conversaAbertaId: 'c1' });
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
