// packages/payments/src/create-payment-link.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7, type Result, ok, err, NotFoundError, UnavailableError } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx, Rfc3339 } from '@cadencia/integrations';

export interface CreatePaymentLinkInput {
  readonly entryId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes?: number;
  readonly providerId: string;
  /**
   * Quem PEDIU o link. Obrigatório quando a criação roda fora de uma requisição
   * de usuário — no consumidor do outbox, `app.current_user_id()` é NULL porque
   * o ator é o sistema, e `created_by` é NOT NULL de propósito: link de cobrança
   * sem autor identificado é cobrança que ninguém responde por.
   */
  readonly createdBy?: string;
}

export interface PaymentLinkCreated {
  readonly paymentLinkId: string;
  readonly url: string;
  readonly providerLinkId: string;
  readonly expiresAt: Rfc3339 | null;
}

export async function createPaymentLink(
  tx: TxClient,
  provider: PaymentProvider,
  providerCtx: ProviderCtx,
  input: CreatePaymentLinkInput,
): Promise<Result<PaymentLinkCreated, NotFoundError | UnavailableError>> {
  // Verificar que o entry existe e está pendente
  const { rows: entryRows } = await tx.query<{ status: string; amount_cents: string }>(
    `SELECT status, amount_cents::text FROM fin.entry WHERE id = $1`,
    [input.entryId],
  );
  if (entryRows.length === 0) {
    return err(new NotFoundError('payment_link.entry_nao_encontrado',
      'lançamento financeiro não encontrado'));
  }

  // Verificar se já existe link pendente para este entry
  const { rows: existingRows } = await tx.query<{ id: string; url: string; provider_link_id: string }>(
    `SELECT id, url, provider_link_id FROM fin.payment_link
      WHERE entry_id = $1 AND status = 'pending'`,
    [input.entryId],
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0]!;
    return ok({
      paymentLinkId: existing.id,
      url: existing.url,
      providerLinkId: existing.provider_link_id,
      expiresAt: null,
    });
  }

  const idempotencyKey = `payment-link:${input.entryId}`;

  // Chamar o provedor
  const result = await provider.createPaymentLink(providerCtx, {
    amountCents: input.amountCents,
    description: input.description,
    expiresInMinutes: input.expiresInMinutes ?? 1440,
  });

  if (!result.ok) {
    return err(new UnavailableError('payment_link.provedor_falhou',
      `provedor de pagamento falhou: ${result.error.detail}`,
      { kind: result.error.kind }));
  }

  const paymentLinkId = uuidv7();
  await tx.query(
    `INSERT INTO fin.payment_link
       (tenant_id, id, entry_id, provider_link_id, url, status,
        amount_cents, provider_id, idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'pending', $5, $6, $7,
             coalesce($8::uuid, app.current_user_id()))`,
    [paymentLinkId, input.entryId, result.value.providerPaymentId, result.value.paymentUrl,
     input.amountCents, input.providerId, idempotencyKey, input.createdBy ?? null],
  );

  return ok({
    paymentLinkId,
    url: result.value.paymentUrl,
    providerLinkId: result.value.providerPaymentId,
    expiresAt: result.value.expiresAt,
  });
}
