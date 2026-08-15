import { withTenantTx, type Actor, type TxClient } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { PaymentProvider, PaymentSnapshot } from '@cadencia/integrations';

export interface RefundPaymentJobInput {
  readonly tenantId: string;
  readonly paymentId: string;
  readonly externalRef: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly refundId: string;
}

export type RefundPaymentJobResult =
  | { readonly status: 'refunded' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'indeterminate'; readonly detail: string }
  | { readonly status: 'ignored'; readonly detail: string };

function devolvido(snapshot: PaymentSnapshot): boolean {
  return snapshot.status === 'refunded' || snapshot.status === 'partially_refunded';
}

async function finalizar(
  tx: TxClient,
  input: RefundPaymentJobInput,
  clinicId: string,
): Promise<RefundPaymentJobResult> {
  await tx.query(
    `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`,
    [input.paymentId],
  );
  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
            jsonb_build_object('reason', $2::text, 'status', 'estornado'::text), $3)`,
    [input.paymentId, input.reason, clinicId],
  );
  return { status: 'refunded' };
}

export async function refundPaymentAtProvider(
  input: RefundPaymentJobInput,
  provider: PaymentProvider,
): Promise<RefundPaymentJobResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'refund-payment',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    const { rows } = await tx.query<{
      status: string; external_ref: string | null; clinic_id: string;
    }>(
      `SELECT status::text, external_ref, clinic_id::text
         FROM fin.entry
        WHERE id = $1
        FOR UPDATE`,
      [input.paymentId],
    );
    const entry = rows[0];
    if (entry === undefined) {
      return { status: 'ignored' as const, detail: 'lancamento_nao_encontrado' };
    }
    if (entry.status === 'estornado') {
      return { status: 'refunded' as const };
    }
    if (entry.status !== 'estorno_pendente') {
      return { status: 'ignored' as const, detail: `status_${entry.status}` };
    }
    if (entry.external_ref !== input.externalRef) {
      return { status: 'ignored' as const, detail: 'external_ref_divergente' };
    }

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `refund:${input.paymentId}:${input.refundId}`,
      deadlineMs: 15_000,
    };

    // Refund e uma operacao UNSAFE. Antes de executa-la, consultamos o PSP.
    // Isso cobre a janela "PSP devolveu o dinheiro, processo morreu antes do
    // COMMIT": na reentrega enxergamos refunded e nao estornamos duas vezes.
    const antes = await provider.getPayment(ctx, { providerPaymentId: input.externalRef });
    if (!antes.ok) {
      // getPayment e SAFE: qualquer falha pode ser repetida sem efeito colateral.
      // Lancar mantém o banco em estorno_pendente e deixa o pg-boss tentar de novo.
      throw new Error(`nao foi possivel reconciliar pagamento antes do estorno: ${antes.error.detail}`);
    }
    if (devolvido(antes.value)) {
      return finalizar(tx, input, entry.clinic_id);
    }

    const refund = await provider.refund(ctx, {
      providerPaymentId: input.externalRef,
      amountCents: input.amountCents,
      reason: input.reason,
    });

    if (refund.ok) {
      return finalizar(tx, input, entry.clinic_id);
    }

    if (refund.error.retrySafe) {
      // Falha comprovadamente segura para retry: rollback preserva pendente.
      throw new Error(refund.error.detail);
    }

    // Timeout de operacao unsafe ou rejeicao potencialmente causada por uma
    // reentrega: nunca adivinhamos. Consultamos o estado real do PSP.
    const depois = await provider.getPayment(ctx, { providerPaymentId: input.externalRef });
    if (depois.ok && devolvido(depois.value)) {
      return finalizar(tx, input, entry.clinic_id);
    }

    if (refund.error.kind === 'timeout' || !depois.ok) {
      await tx.query(
        `UPDATE fin.entry SET status = 'estorno_indeterminado' WHERE id = $1`,
        [input.paymentId],
      );
      await tx.query(
        `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'falha',
                jsonb_build_object('reason', $2::text,
                                   'status', 'estorno_indeterminado'::text), $3)`,
        [input.paymentId, input.reason, entry.clinic_id],
      );
      return { status: 'indeterminate', detail: refund.error.detail };
    }

    // Rejeicao definitiva e PSP confirma que o pagamento segue nao estornado:
    // desfazemos apenas o estado de pedido, nunca um estorno confirmado.
    await tx.query(`UPDATE fin.entry SET status = 'pago' WHERE id = $1`, [input.paymentId]);
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'falha',
              jsonb_build_object('reason', $2::text, 'status', 'pago'::text), $3)`,
      [input.paymentId, input.reason, entry.clinic_id],
    );
    return { status: 'failed', detail: refund.error.detail };
  });
}
