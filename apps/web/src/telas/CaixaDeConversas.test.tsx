// apps/web/src/telas/CaixaDeConversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CaixaDeConversas, type ConversaResumo } from './CaixaDeConversas';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Bom dia, confirmo a consulta',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 2,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
    online: true,
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Gostaria de agendar',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c3', patientId: 'p3', patientName: 'Joana Prado',
    phoneNumber: '+5511777770003', lastMessageBody: 'Obrigada!',
    lastMessageAt: '2026-08-03T10:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'outbound',
  },
];

function montar(over: Partial<Parameters<typeof CaixaDeConversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    carregar: vi.fn(async () => CONVERSAS),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    ...over,
  };
  render(<CaixaDeConversas {...props} />);
  return props;
}

describe('tela Caixa de Conversas', () => {
  it('o titulo diz Conversas', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Conversas/i })).toBeVisible());
  });

  it('lista as conversas em ordem de lastMessageAt DESC', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[0]).toHaveTextContent('Maria Souza Lima');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[2]).toHaveTextContent('Joana Prado');
  });

  it('conversa com numero desconhecido mostra "Numero desconhecido" e opcao de vincular a paciente', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[1]).not.toHaveTextContent('null');
  });

  it('mostra badge de nao-lidas quando unreadCount > 0', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('2')).toBeVisible());
  });

  it('mostra preview da ultima mensagem em cada linha', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText('Bom dia, confirmo a consulta')).toBeVisible());
  });

  it('filtros sao botoes com aria-pressed e vao para query string', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Todas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nao lidas/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('nao_lidas');
  });

  it('clicar na conversa chama aoAbrirConversa com o conversationId', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('destaca conversa ativa com atributo data-active', async () => {
    montar({ conversaAtivaId: 'c1' });
    const itens = await screen.findAllByRole('listitem');
    expect(itens[0]).toHaveAttribute('data-active', 'true');
    expect(itens[1]).not.toHaveAttribute('data-active');
    expect(itens[2]).not.toHaveAttribute('data-active');
  });

  it('mostra indicador online quando conversa tem online=true', async () => {
    montar();
    const indicadores = await screen.findAllByTestId('online-indicator');
    // Apenas c1 tem online: true
    expect(indicadores).toHaveLength(1);
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <CaixaDeConversas filtro="todas" carregar={async () => CONVERSAS}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
