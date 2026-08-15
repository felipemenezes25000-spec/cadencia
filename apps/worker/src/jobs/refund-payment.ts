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

function devolvidoIntegral(snapshot: PaymentSnapshot): boolean {
  return snapshot.status === 'refunded';
}

function devolvidoParcial(snapshot: PaymentSnapshot): boolean {
  return snapshot.status === 'partially_refunded';
}

async function finalizar(
  tx: TxClient,
  input: RefundPaymentJobInput,
  clinicId: string,
): Promise<RefundPaymentJobResult> {
  await tx.query(`UPDATE fin.entry SET status = 'estornado' WHERE id = $1`, [input.paymentId]);
  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
            jsonb_build_object('reason', $2::text, 'status', 'estornado'::text), $3)`,
    [input.paymentId, input.reason, clinicId],
  );
  return { status: 'refunded' };
}

async function marcarIndeterminado(
  tx: TxClient,
  input: RefundPaymentJobInput,
  clinicId: string,
  detail: string,
): Promise<RefundPaymentJobResult> {
  await tx.query(
    `UPDATE fin.entry SET status = 'estorno_indeterminado' WHERE id = $1`,
    [input.paymentId],
  );
  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'falha',
            jsonb_build_object('reason', $2::text,
                               'status', 'estorno_indeterminado'::text,
                               'detail', $3::text), $4)`,
    [input.paymentId, input.reason, detail, clinicId],
  );
  return { status: 'indeterminate', detail };
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
    if (entry.status === 'estornado') return { status: 'refunded' as const };
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

    const antes = await provider.getPayment(ctx, { providerPaymentId: input.externalRef });
    if (!antes.ok) {
      throw new Error(`nao foi possivel reconciliar pagamento antes do estorno: ${antes.error.detail}`);
    }
    if (devolvidoIntegral(antes.value)) {
      return finalizar(tx, input, entry.clinic_id);
    }
    if (devolvidoParcial(antes.value)) {
      return marcarIndeterminado(
        tx, input, entry.clinic_id,
        'PSP informa estorno parcial; o dominio local so representa estorno integral',
      );
    }

    const refund = await provider.refund(ctx, {
      providerPaymentId: input.externalRef,
      amountCents: input.amountCents,
      reason: input.reason,
    });

    if (refund.ok) {
      if (refund.value.status === 'refunded') {
        return finalizar(tx, input, entry.clinic_id);
      }
      if (refund.value.status === 'partially_refunded') {
        return marcarIndeterminado(
          tx, input, entry.clinic_id,
          'PSP confirmou apenas estorno parcial',
        );
      }

      // Resposta 2xx com estado que não prova devolução: consultar a fonte de
      // verdade em vez de assumir sucesso pela camada HTTP.
      const confirmado = await provider.getPayment(ctx, { providerPaymentId: input.externalRef });
      if (confirmado.ok && devolvidoIntegral(confirmado.value)) {
        return finalizar(tx, input, entry.clinic_id);
      }
      if (confirmado.ok && devolvidoParcial(confirmado.value)) {
        return marcarIndeterminado(
          tx, input, entry.clinic_id,
          'PSP respondeu sucesso, mas o pagamento ficou parcialmente estornado',
        );
      }
      return marcarIndeterminado(
        tx, input, entry.clinic_id,
        'PSP respondeu sucesso sem confirmar estado refunded',
      );
    }

    if (refund.error.retrySafe) {
      throw new Error(refund.error.detail);
    }

    const depois = await provider.getPayment(ctx, { providerPaymentId: input.externalRef });
    if (depois.ok && devolvidoIntegral(depois.value)) {
      return finalizar(tx, input, entry.clinic_id);
    }
    if (depois.ok && devolvidoParcial(depois.value)) {
      return marcarIndeterminado(
        tx, input, entry.clinic_id,
        'estorno parcial detectado durante reconciliacao do PSP',
      );
    }

    if (refund.error.kind === 'timeout' || !depois.ok) {
      return marcarIndeterminado(tx, input, entry.clinic_id, refund.error.detail);
    }

    await tx.query(`UPDATE fin.entry SET status = 'pago' WHERE id = $1`, [input.paymentId]);
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'falha',
              jsonb_build_object('reason', $2::text, 'status', 'pago'::text), $3)`,
      [input.paymentId, input.reason, entry.clinic_id],
    );
    return { status: 'failed', detail: refund.error.detail };
  });
}
