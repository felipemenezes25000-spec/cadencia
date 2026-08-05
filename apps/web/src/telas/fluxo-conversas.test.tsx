// apps/web/src/telas/fluxo-conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c-desconhecido', patientId: null, patientName: null,
    phoneNumber: '+5521900001111', lastMessageBody: 'Gostaria de agendar uma consulta',
    lastMessageAt: '2026-08-03T15:00:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Gostaria de agendar uma consulta',
    sentAt: '2026-08-03T15:00:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

describe('fluxo: conversa com numero desconhecido', () => {
  it('na lista, numero desconhecido exibe o telefone em vez de nome', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('+5521900001111')).toBeVisible();
    });
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('ao abrir a conversa, mostra botao "Vincular a paciente"', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
  });

  it('clicar em "Vincular a paciente" chama o callback', async () => {
    const aoVincularPaciente = vi.fn();
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={aoVincularPaciente} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Vincular a paciente/ }));
    expect(aoVincularPaciente).toHaveBeenCalled();
  });

  it('avatar do numero desconhecido mostra "#" em vez de iniciais', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('#')).toBeVisible());
  });

  it('thread de mensagens funciona normalmente mesmo sem paciente vinculado', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('Gostaria de agendar uma consulta')).toBeVisible());
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    expect(input).toBeVisible();
  });
});
