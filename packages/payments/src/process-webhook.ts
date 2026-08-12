// packages/payments/src/process-webhook.ts
import type { TxClient } from '@cadencia/db';
import { NotFoundError, ok, err, type Result, systemClock, isoFromMs } from '@cadencia/kernel';

export interface WebhookPayload {
  readonly providerPaymentId: string;
  readonly status: string;
  readonly paidAt?: string;
  readonly feeCents?: number;
  readonly method?: string;
}

export interface WebhookProcessed {
  readonly paymentLinkId: string;
  readonly entryId: string;
  readonly newStatus: string;
}

export async function processPaymentWebhook(
  tx: TxClient,
  payload: WebhookPayload,
): Promise<Result<WebhookProcessed, NotFoundError>> {
  // Buscar o payment_link pelo provider_link_id
  const { rows } = await tx.query<{
    id: string; entry_id: string; status: string;
  }>(
    `SELECT id, entry_id, status FROM fin.payment_link
      WHERE provider_link_id = $1`,
    [payload.providerPaymentId],
  );

  if (rows.length === 0) {
    return err(new NotFoundError('webhook.link_nao_encontrado',
      `link de pagamento nao encontrado para provider_link_id: ${payload.providerPaymentId}`));
  }

  const link = rows[0]!;

  // Idempotência: se já está pago, retorna sem erro
  if (link.status === 'paid' && payload.status === 'paid') {
    return ok({
      paymentLinkId: link.id,
      entryId: link.entry_id,
      newStatus: 'paid',
    });
  }

  // Atualizar o status do payment_link
  await tx.query(
    `UPDATE fin.payment_link
        SET status = $1,
            paid_at = CASE WHEN $1 = 'paid' THEN $2::timestamptz ELSE paid_at END,
            fee_cents = CASE WHEN $3::bigint IS NOT NULL THEN $3::bigint ELSE fee_cents END,
            method = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE method END,
            webhook_raw = $5::jsonb,
            updated_at = clock_timestamp()
      WHERE id = $6`,
    [
      payload.status,
      payload.paidAt ?? null,
      payload.feeCents ?? null,
      payload.method ?? null,
      JSON.stringify(payload),
      link.id,
    ],
  );

  // Se o pagamento foi confirmado, marcar paid_at no fin.entry
  if (payload.status === 'paid') {
    await tx.query(
      `UPDATE fin.entry
          SET paid_at = COALESCE(paid_at, $1::timestamptz),
              status = 'pago',
              external_ref = $2
        WHERE id = $3 AND paid_at IS NULL`,
      [payload.paidAt ?? isoFromMs(systemClock.nowMs()), payload.providerPaymentId, link.entry_id],
    );
  }

  return ok({
    paymentLinkId: link.id,
    entryId: link.entry_id,
    newStatus: payload.status,
  });
}
