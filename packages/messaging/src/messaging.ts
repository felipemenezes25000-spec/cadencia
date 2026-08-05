// packages/messaging/src/messaging.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos de falha
// ---------------------------------------------------------------------------

export type MessagingFailure =
  | { kind: 'canal_nao_encontrado' }
  | { kind: 'conversa_nao_encontrada' }
  | { kind: 'canal_inativo' };

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

export interface ResolveConversationInput {
  readonly channelIdentityId: string;
  readonly remotePhone: string;
  readonly patientId?: string;
}

export interface ResolvedConversation {
  readonly conversationId: string;
  readonly created: boolean;
  readonly patientId: string | null;
}

export async function resolveConversation(
  tx: TxClient, i: ResolveConversationInput,
): Promise<Result<ResolvedConversation, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Buscar conversa ativa pelo telefone.
  const existente = await tx.query<{ id: string; patient_id: string | null }>(
    `SELECT id, patient_id FROM msg.conversation
      WHERE channel_identity_id = $1
        AND remote_phone = $2
        AND status = 'active'`,
    [i.channelIdentityId, i.remotePhone]);

  if (existente.rows.length > 0) {
    const conv = existente.rows[0]!;
    return ok({
      conversationId: conv.id,
      created: false,
      patientId: conv.patient_id,
    });
  }

  // 3. Criar conversa nova.
  let patientId: string | null = i.patientId ?? null;

  // Se patientId nao foi fornecido, tenta lookup pelo telefone do paciente.
  if (patientId === null) {
    const paciente = await tx.query<{ id: string }>(
      `SELECT id FROM clin.patient
        WHERE phone_primary = $1
        LIMIT 1`,
      [i.remotePhone]);
    if (paciente.rows.length > 0) {
      patientId = paciente.rows[0]!.id;
    }
  }

  const conversationId = uuidv7();
  await tx.query(
    `INSERT INTO msg.conversation
       (id, channel_identity_id, patient_id, remote_phone, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [conversationId, i.channelIdentityId, patientId, i.remotePhone]);

  return ok({ conversationId, created: true, patientId });
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  readonly conversationId: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly templateKey?: string;
}

export async function sendMessage(
  tx: TxClient, i: SendMessageInput,
): Promise<Result<{ messageId: string }, MessagingFailure>> {
  // 1. Verificar que a conversa existe e obter o canal.
  const conv = await tx.query<{ channel: string }>(
    `SELECT ci.channel
       FROM msg.conversation c
       JOIN msg.channel_identity ci
         ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
      WHERE c.id = $1`,
    [i.conversationId]);
  if (conv.rows.length === 0) return err({ kind: 'conversa_nao_encontrada' });

  const channel = conv.rows[0]!.channel;
  const messageId = uuidv7();

  // 2. Inserir mensagem com status queued (o worker despacha via provedor).
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        template_key, status)
     VALUES ($1, $2, 'outbound', $3, $4, $5, $6, 'queued')`,
    [messageId, i.conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null, i.templateKey ?? null]);

  // 3. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [i.conversationId]);

  return ok({ messageId });
}

// ---------------------------------------------------------------------------
// receiveInbound
// ---------------------------------------------------------------------------

export interface ReceiveInboundInput {
  readonly channelIdentityId: string;
  readonly rawPayload: unknown;
  readonly remotePhone: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly externalId: string;
  readonly sentAt: string;            // RFC 3339
}

export interface ReceivedInbound {
  readonly eventId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export async function receiveInbound(
  tx: TxClient, i: ReceiveInboundInput,
): Promise<Result<ReceivedInbound, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Gravar payload bruto em inbound_event — ANTES de qualquer parse.
  //    Parser bugado nao perde mensagem de paciente.
  const eventId = uuidv7();
  await tx.query(
    `INSERT INTO msg.inbound_event
       (id, channel_identity_id, raw_payload, processed_at)
     VALUES ($1, $2, $3, clock_timestamp())`,
    [eventId, i.channelIdentityId, JSON.stringify(i.rawPayload)]);

  // 3. Resolver conversa pelo telefone.
  const convResult = await resolveConversation(tx, {
    channelIdentityId: i.channelIdentityId,
    remotePhone: i.remotePhone,
  });
  if (!convResult.ok) return convResult;

  const conversationId = convResult.value.conversationId;

  // 4. Obter o canal da identidade.
  const chQuery = await tx.query<{ channel: string }>(
    `SELECT channel FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  const channel = chQuery.rows[0]!.channel;

  // 5. Criar mensagem inbound.
  const messageId = uuidv7();
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        status, external_id, sent_at)
     VALUES ($1, $2, 'inbound', $3, $4, $5, 'delivered', $6, $7::timestamptz)`,
    [messageId, conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null,
     i.externalId, i.sentAt]);

  // 6. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [conversationId]);

  return ok({ eventId, messageId, conversationId });
}
