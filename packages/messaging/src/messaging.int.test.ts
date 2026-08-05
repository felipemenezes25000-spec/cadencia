// packages/messaging/src/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveConversation, sendMessage, receiveInbound } from './messaging';
import { semearMensageria, type SementeMensageria } from './test-support';

let s: SementeMensageria;
let actor: Actor;

beforeAll(async () => {
  s = await semearMensageria();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('resolveConversation', () => {
  it('cria conversa nova e vincula paciente pelo telefone', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.conversationId).toBeTruthy();
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('retorna conversa existente sem criar duplicata', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(false);
  });

  it('cria conversa com patient_id NULL para numero desconhecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511888880000',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.patientId).toBeNull();
  });

  it('usa patient_id explicito quando fornecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511777770000',
      patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: uuidv7(),
      remotePhone: '+5511999990001',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});

let conversationId = '';

describe('sendMessage', () => {
  beforeAll(async () => {
    // Garantir que existe uma conversa para usar nos testes.
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511666660000',
    }));
    if (r.ok) conversationId = r.value.conversationId;
  });

  it('cria mensagem outbound com status queued', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola, sua consulta esta confirmada!',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; channel: string;
    }>(
      `SELECT direction, status, body_text, channel
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]).toEqual({
      direction: 'outbound',
      status: 'queued',
      body_text: 'Ola, sua consulta esta confirmada!',
      channel: 'whatsapp',
    });
  });

  it('cria mensagem outbound com template_key', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola Maria, sua consulta esta confirmada para 14/08 as 10:00.',
      templateKey: 'confirmacao_consulta',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      template_key: string | null;
    }>(
      `SELECT template_key FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]?.template_key).toBe('confirmacao_consulta');
  });

  it('atualiza last_message_at da conversa', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tAntes = antes.rows[0]?.last_message_at;

    await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId, bodyText: 'outra mensagem',
    }));

    const depois = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tDepois = depois.rows[0]?.last_message_at;
    expect(tDepois).not.toBeNull();
    if (tAntes != null && tDepois != null) {
      expect(tDepois >= tAntes).toBe(true);
    }
  });

  it('recusa conversa inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId: uuidv7(),
      bodyText: 'nao vai',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'conversa_nao_encontrada' } });
  });
});

describe('receiveInbound', () => {
  it('grava payload bruto em inbound_event e cria mensagem inbound', async () => {
    const rawPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-fake-001', changes: [{ value: { messages: [{ id: 'wamid.xyz' }] } }] }],
    };

    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload,
      remotePhone: '+5511555550000',
      bodyText: 'Quero marcar consulta',
      externalId: 'wamid.xyz',
      sentAt: '2026-08-04T10:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eventId).toBeTruthy();
    expect(r.value.messageId).toBeTruthy();
    expect(r.value.conversationId).toBeTruthy();

    // Verificar inbound_event gravado
    const { rows: evtRows } = await withTenantTx(actor, (tx) => tx.query<{
      raw_payload: unknown; processed_at: string | null;
    }>(
      `SELECT raw_payload, processed_at FROM msg.inbound_event WHERE id = $1`,
      [r.value.eventId]));
    expect(evtRows[0]?.raw_payload).toEqual(rawPayload);
    expect(evtRows[0]?.processed_at).not.toBeNull();

    // Verificar mensagem inbound criada
    const { rows: msgRows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; external_id: string;
    }>(
      `SELECT direction, status, body_text, external_id
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(msgRows[0]).toEqual({
      direction: 'inbound',
      status: 'delivered',
      body_text: 'Quero marcar consulta',
      external_id: 'wamid.xyz',
    });
  });

  it('vincula paciente na conversa quando telefone bate', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload: { test: true },
      remotePhone: s.patientPhone,
      bodyText: 'Boa tarde',
      externalId: 'wamid.abc',
      sentAt: '2026-08-04T11:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // A conversa para o telefone do paciente ja existe (criada no describe anterior);
    // deve ter o patient_id vinculado.
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      patient_id: string | null;
    }>(
      `SELECT patient_id FROM msg.conversation WHERE id = $1`,
      [r.value.conversationId]));
    expect(rows[0]?.patient_id).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: uuidv7(),
      rawPayload: {},
      remotePhone: '+5511999990001',
      bodyText: 'teste',
      externalId: 'wamid.000',
      sentAt: '2026-08-04T12:00:00.000Z',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
