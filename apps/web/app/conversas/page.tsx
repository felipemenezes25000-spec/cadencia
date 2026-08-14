'use client';

import { Suspense, useRef } from 'react';
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
 * lê a conversa está em pt-BR e lê 11/08 — o formato ISO no meio de um diálogo
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

  /* A tela Hoje manda para `/conversas?patientId=<id>` quando a recepção clica
     em "mensagem" na fila. A caixa só sabia abrir por `?conversa=<id>`, então o
     link caía na lista genérica e o clique não fazia nada visível — parecia que
     a conversa não existia. O `patientId` vira `conversa` assim que a lista
     chega, porque só a lista sabe qual conversa pertence a qual paciente. */
  const [patientId, setPatientId] = useQueryState('patientId');
  const resolvido = useRef(false);

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

        /* Uma vez só: se o usuário depois fechar a conversa pelo "voltar", o
           `patientId` ainda na URL não pode reabri-la no próximo refetch. */
        if (patientId !== null && !resolvido.current) {
          resolvido.current = true;
          const doPaciente = r.itens.find((c) => c.patientId === patientId);
          void setPatientId(null);
          if (doPaciente !== undefined) void setAbertaId(doPaciente.conversationId);
        }

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

        // O filtro é do cliente porque a caixa cabe inteira em memória (uma
        // clínica tem dezenas de conversas ativas, não milhares) e alternar
        // entre abas sem ida ao servidor é o que faz a caixa parecer instantânea.
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
      aoVincularPaciente={() => { /* vínculo entra com a busca de paciente */ }}
      aoSelecionarTemplate={() => { /* templates já têm endpoint próprio */ }}
    />
  );
}

export default function PaginaConversas() {
  return <Suspense><ConversasInner /></Suspense>;
}
