'use client';

import { Suspense } from 'react';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Conversas } from '../../src/telas/Conversas';
import type { ConversaResumo, FiltroConversas } from '../../src/telas/CaixaDeConversas';
import type { ContextoConversa, Mensagem } from '../../src/telas/PainelDeConversa';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

const FILTROS = ['todas', 'nao_lidas', 'whatsapp'] as const;

interface ConversaDaApi {
  conversationId: string;
  patientId: string | null;
  patientName: string | null;
  channel: string;
  remotePhone: string;
  status: string;
  lastMessageAt: string | null;
  lastMessageBody: string;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  unreadCount: number;
}

interface MensagemDaApi {
  messageId: string;
  direction: 'inbound' | 'outbound';
  bodyText: string | null;
  status: string;
  createdAt: string;
}

interface ContextoDaApi {
  proximoAgendamento: {
    quando: string; profissional: string; procedimento: string | null;
  } | null;
  pendencias: string[];
  historicoAgendamentos: { quando: string; status: string }[];
}

const ENTREGA: Record<string, Mensagem['deliveryStatus']> = {
  queued: 'queued', sent: 'sent', delivered: 'delivered',
  read: 'read', failed: 'failed',
};

function hora(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * O painel lateral renderiza `dia` cru. Passar '2026-08-11' funciona, mas quem
 * le a conversa esta em pt-BR e le 11/08 — o formato ISO no meio de um dialogo
 * denuncia que aquilo veio de um banco.
 */
function diaCurto(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return ano === undefined ? iso : `${dia}/${mes}/${ano}`;
}

function ConversasInner() {
  const { clinicId, csrfToken } = useSessao();
  const [filtro, setFiltro] = useQueryState('filtro',
    parseAsStringLiteral(FILTROS).withDefault('todas'));
  const [abertaId, setAbertaId] = useQueryState('conversa');

  return (
    <Conversas
      filtro={filtro as FiltroConversas}
      conversaAbertaId={abertaId}
      aoMudarFiltro={(f) => { void setFiltro(f); }}
      aoAbrirConversa={(id) => { void setAbertaId(id); }}
      aoVoltar={() => { void setAbertaId(null); }}
      carregarConversas={async (f) => {
        const r = await apiFetch<{ itens: ConversaDaApi[] }>(
          '/v1/conversations', { clinicId, csrfToken });

        const todas: ConversaResumo[] = r.itens.map((c) => ({
          conversationId: c.conversationId,
          patientId: c.patientId,
          patientName: c.patientName,
          phoneNumber: c.remotePhone,
          lastMessageBody: c.lastMessageBody,
          lastMessageAt: c.lastMessageAt ?? '',
          unreadCount: c.unreadCount,
          channel: (c.channel === 'sms' || c.channel === 'email')
            ? c.channel : 'whatsapp',
          status: c.status === 'archived' ? 'arquivada' : 'ativa',
          lastMessageDirection: c.lastMessageDirection ?? 'outbound',
        }));

        // O filtro e do cliente porque a caixa cabe inteira em memoria (uma
        // clinica tem dezenas de conversas ativas, nao milhares) e alternar
        // entre abas sem ida ao servidor e o que faz a caixa parecer instantanea.
        if (f === 'nao_lidas') return todas.filter((c) => c.unreadCount > 0);
        if (f === 'whatsapp') return todas.filter((c) => c.channel === 'whatsapp');
        return todas;
      }}
      carregarMensagens={async (conversationId) => {
        const r = await apiFetch<{ itens: MensagemDaApi[] }>(
          `/v1/conversations/${conversationId}/messages`, { clinicId, csrfToken });
        const msgs: Mensagem[] = r.itens.map((m) => ({
          messageId: m.messageId,
          direction: m.direction,
          body: m.bodyText ?? '',
          sentAt: m.createdAt,
          deliveryStatus: ENTREGA[m.status] ?? 'sent',
        }));
        return msgs;
      }}
      carregarContexto={async (conversationId) => {
        const c = await apiFetch<ContextoDaApi>(
          `/v1/conversations/${conversationId}/contexto`, { clinicId, csrfToken });
        const ctx: ContextoConversa = {
          proximoAgendamento: c.proximoAgendamento === null ? null : {
            dia: diaCurto(c.proximoAgendamento.quando),
            hora: hora(c.proximoAgendamento.quando),
            procedimento: c.proximoAgendamento.procedimento ?? 'Consulta',
          },
          pendencias: c.pendencias,
          historicoAgendamentos: c.historicoAgendamentos.map((h) => ({
            dia: diaCurto(h.quando),
            procedimento: 'Atendimento',
            status: h.status,
          })),
        };
        return ctx;
      }}
      aoEnviar={async (body) => {
        if (abertaId === null) throw new Error('nenhuma conversa aberta');
        return apiFetch<{ messageId: string }>(
          `/v1/conversations/${abertaId}/messages`,
          { method: 'POST', body: { bodyText: body }, clinicId, csrfToken });
      }}
      aoVincularPaciente={() => { /* vinculo entra com a busca de paciente */ }}
      aoSelecionarTemplate={() => { /* templates ja tem endpoint proprio */ }}
    />
  );
}

export default function PaginaConversas() {
  return <Suspense><ConversasInner /></Suspense>;
}
