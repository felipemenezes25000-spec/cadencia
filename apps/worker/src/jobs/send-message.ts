// apps/worker/src/jobs/send-message.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { MessagingProvider } from '@cadencia/integrations';

export interface SendMessageInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export type SendMessageResult =
  | { readonly messageId: string; readonly status: 'sent'; readonly providerMessageId: string | null }
  | { readonly messageId: string; readonly status: 'retryable'; readonly providerMessageId: null; readonly detail: string }
  | { readonly messageId: string; readonly status: 'indeterminate'; readonly providerMessageId: null; readonly detail: string }
  | { readonly messageId: string; readonly status: 'failed'; readonly providerMessageId: null; readonly detail: string }
  | { readonly messageId: string; readonly status: 'ignored'; readonly providerMessageId: string | null; readonly detail: string };

export interface MessagingProvidersByChannel {
  readonly whatsapp: MessagingProvider;
  readonly sms: MessagingProvider;
}

function providerDoCanal(
  providers: MessagingProvider | MessagingProvidersByChannel,
  channel: string,
): MessagingProvider | null {
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

  // Primeira transação: resolve tudo e CLAIM a mensagem. Nenhuma chamada HTTP
  // acontece enquanto uma conexão do PostgreSQL está presa.
  const preparo = await withTenantTx(actor, async (tx) => {
    const { rows } = await tx.query<{
      body_text: string | null; conversation_id: string; status: string;
      external_id: string | null; remote_phone: string;
      provider_ref: string; channel: string;
    }>(
      `SELECT m.body_text, m.conversation_id, m.status, m.external_id,
              c.remote_phone,
              coalesce(ci.provider_ref, ci.id::text) AS provider_ref,
              ci.channel::text AS channel
         FROM msg.message m
         JOIN msg.conversation c
           ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
         JOIN msg.channel_identity ci
           ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
        WHERE m.id = $1 AND m.conversation_id = $2
        FOR UPDATE OF m`,
      [input.messageId, input.conversationId],
    );

    const row = rows[0];
    if (row === undefined) return { kind: 'missing' as const };
    if (row.status === 'sent' || row.status === 'delivered' || row.status === 'read') {
      return { kind: 'already-sent' as const, externalId: row.external_id };
    }
    if (row.status === 'sending' || row.status === 'indeterminate') {
      // Reexecutar uma operação unsafe sem conseguir saber se o provedor a
      // recebeu pode duplicar mensagem. Sinalizamos para reconciliação humana.
      return { kind: 'indeterminate' as const };
    }
    if (row.status === 'failed') return { kind: 'failed' as const };

    const claimed = await tx.query(
      `UPDATE msg.message
          SET status = 'sending', send_attempted_at = clock_timestamp()
        WHERE id = $1 AND status = 'queued'`,
      [input.messageId],
    );
    if (claimed.rowCount === 0) return { kind: 'indeterminate' as const };

    return {
      kind: 'ready' as const,
      bodyText: row.body_text ?? '',
      conversationId: row.conversation_id,
      remotePhone: row.remote_phone,
      providerRef: row.provider_ref,
      channel: row.channel,
    };
  });

  if (preparo.kind === 'missing') {
    return { messageId: input.messageId, status: 'ignored', providerMessageId: null,
      detail: 'mensagem_ou_conversa_nao_encontrada' };
  }
  if (preparo.kind === 'already-sent') {
    return { messageId: input.messageId, status: 'sent', providerMessageId: preparo.externalId };
  }
  if (preparo.kind === 'indeterminate') {
    return { messageId: input.messageId, status: 'indeterminate', providerMessageId: null,
      detail: 'envio_anterior_sem_resultado_conclusivo' };
  }
  if (preparo.kind === 'failed') {
    return { messageId: input.messageId, status: 'failed', providerMessageId: null,
      detail: 'falha_terminal_ja_registrada' };
  }

  const messaging = providerDoCanal(providers, preparo.channel);
  if (messaging === null) {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`UPDATE msg.message SET status = 'failed' WHERE id = $1 AND status = 'sending'`,
        [input.messageId]);
    });
    return { messageId: input.messageId, status: 'failed', providerMessageId: null,
      detail: `canal_nao_suportado:${preparo.channel}` };
  }

  const ctx = {
    tenantId: input.tenantId,
    actorUserId: null,
    requestId: actor.requestId,
    idempotencyKey: `msg-${input.messageId}`,
    deadlineMs: 10_000,
  };

  // HTTP fora da transação. O estado `sending` protege contra reexecução cega
  // se o processo morrer depois que o provedor recebeu a mensagem.
  const resultado = await messaging.send(ctx, {
    channelIdentityRef: preparo.providerRef,
    to: preparo.remotePhone,
    body: { kind: 'text', text: preparo.bodyText },
    conversationId: preparo.conversationId,
  });

  if (resultado.ok) {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', external_id = $2,
                sent_at = coalesce(sent_at, clock_timestamp())
          WHERE id = $1 AND status = 'sending'`,
        [input.messageId, resultado.value.providerMessageId],
      );
    });
    return { messageId: input.messageId, status: 'sent',
      providerMessageId: resultado.value.providerMessageId };
  }

  if (resultado.error.retrySafe) {
    // O provider garante que repetir é seguro: volta para queued e o handler
    // lança erro para o pg-boss aplicar retry/backoff.
    await withTenantTx(actor, async (tx) => {
      await tx.query(`UPDATE msg.message SET status = 'queued' WHERE id = $1 AND status = 'sending'`,
        [input.messageId]);
    });
    return { messageId: input.messageId, status: 'retryable', providerMessageId: null,
      detail: resultado.error.detail };
  }

  if (resultado.error.kind === 'timeout') {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `UPDATE msg.message SET status = 'indeterminate' WHERE id = $1 AND status = 'sending'`,
        [input.messageId],
      );
    });
    return { messageId: input.messageId, status: 'indeterminate', providerMessageId: null,
      detail: resultado.error.detail };
  }

  await withTenantTx(actor, async (tx) => {
    await tx.query(`UPDATE msg.message SET status = 'failed' WHERE id = $1 AND status = 'sending'`,
      [input.messageId]);
  });
  return { messageId: input.messageId, status: 'failed', providerMessageId: null,
    detail: resultado.error.detail };
}
