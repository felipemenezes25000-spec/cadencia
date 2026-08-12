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

export async function sendMessage(
  input: SendMessageInput,
  messaging: MessagingProvider,
): Promise<SendMessageResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'send-message',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    // Ler a mensagem (coluna real: body_text, não body)
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

    // Ler a conversa para obter o destinatário e a channel_identity
    // Coluna real: remote_phone (não remote_address)
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

    // Ler o ref da channel_identity
    const { rows: ciRows } = await tx.query<{ provider_ref: string }>(
      `SELECT coalesce(provider_ref, id::text) AS provider_ref
         FROM msg.channel_identity WHERE id = $1`,
      [conv.channel_identity_id]);

    const channelIdentityRef = ciRows[0]?.provider_ref ?? '';

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `msg-${input.messageId}`,
      deadlineMs: 10_000,
    };

    const resultado = await messaging.send(ctx, {
      channelIdentityRef,
      to: conv.remote_phone as never,
      body: { kind: 'text', text: msg.body_text ?? '' },
      conversationId: msg.conversation_id,
    });

    if (resultado.ok) {
      // Coluna real: external_id (não provider_message_id)
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', external_id = $2, sent_at = clock_timestamp()
          WHERE id = $1`,
        [input.messageId, resultado.value.providerMessageId]);
      return { messageId: input.messageId, status: 'sent' as const,
               providerMessageId: resultado.value.providerMessageId };
    }

    // Timeout em operação unsafe: estado indeterminado.
    // O schema msg.message não tem status 'indeterminate', apenas
    // queued|sent|delivered|read|failed. Mantemos como 'failed' e
    // registramos para reconciliação manual.
    await tx.query(
      `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
      [input.messageId]);
    return { messageId: input.messageId, status: 'failed' as const,
             providerMessageId: null };
  });
}
