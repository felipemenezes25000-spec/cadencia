// apps/worker/src/jobs/send-message.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { MessagingProvider } from '@cadencia/integrations';

export interface SendMessageInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export interface SendMessageResult {
  readonly messageId: string;
  readonly status: 'sent' | 'failed';
  readonly providerMessageId: string | null;
}

export interface MessagingProvidersByChannel {
  readonly whatsapp: MessagingProvider;
  readonly sms: MessagingProvider;
}

function providerDoCanal(
  providers: MessagingProvider | MessagingProvidersByChannel,
  channel: string,
): MessagingProvider | null {
  // Compatibilidade com testes e consumidores que injetam um único fake.
  if ('send' in providers) return providers;
  if (channel === 'whatsapp') return providers.whatsapp;
  if (channel === 'sms') return providers.sms;
  return null;
}

export async function sendMessage(
  input: SendMessageInput,
  providers: MessagingProvider | MessagingProvidersByChannel,
): Promise<SendMessageResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'send-message',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    const { rows: msgRows } = await tx.query<{
      body_text: string; conversation_id: string;
    }>(
      `SELECT body_text, conversation_id FROM msg.message WHERE id = $1`,
      [input.messageId]);

    if (msgRows.length === 0) {
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const msg = msgRows[0]!;

    const { rows: convRows } = await tx.query<{
      remote_phone: string; channel_identity_id: string;
    }>(
      `SELECT remote_phone, channel_identity_id
         FROM msg.conversation WHERE id = $1`,
      [msg.conversation_id]);

    if (convRows.length === 0) {
      await tx.query(
        `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const conv = convRows[0]!;

    const { rows: ciRows } = await tx.query<{
      provider_ref: string; channel: string;
    }>(
      `SELECT coalesce(provider_ref, id::text) AS provider_ref, channel::text AS channel
         FROM msg.channel_identity WHERE id = $1`,
      [conv.channel_identity_id]);

    const identidade = ciRows[0];
    if (identidade === undefined) {
      await tx.query(`UPDATE msg.message SET status = 'failed' WHERE id = $1`, [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const, providerMessageId: null };
    }

    const messaging = providerDoCanal(providers, identidade.channel);
    if (messaging === null) {
      await tx.query(`UPDATE msg.message SET status = 'failed' WHERE id = $1`, [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const, providerMessageId: null };
    }

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `msg-${input.messageId}`,
      deadlineMs: 10_000,
    };

    const resultado = await messaging.send(ctx, {
      channelIdentityRef: identidade.provider_ref,
      to: conv.remote_phone as never,
      body: { kind: 'text', text: msg.body_text ?? '' },
      conversationId: msg.conversation_id,
    });

    if (resultado.ok) {
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', external_id = $2, sent_at = clock_timestamp()
          WHERE id = $1`,
        [input.messageId, resultado.value.providerMessageId]);
      return { messageId: input.messageId, status: 'sent' as const,
               providerMessageId: resultado.value.providerMessageId };
    }

    await tx.query(
      `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
      [input.messageId]);
    return { messageId: input.messageId, status: 'failed' as const,
             providerMessageId: null };
  });
}
