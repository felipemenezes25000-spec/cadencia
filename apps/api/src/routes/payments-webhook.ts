// apps/api/src/routes/payments-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

type PaymentEventKind =
  | 'payment.confirmed'
  | 'payment.refunded'
  | 'payment.partially_refunded'
  | 'payment.refund_in_progress'
  | 'payment.refund_denied'
  | 'payment.ignored';

interface PaymentEvent {
  readonly eventType: PaymentEventKind;
  readonly sourceEvent: string;
  readonly paymentLinkId?: string;
  readonly providerPaymentId?: string;
  readonly amountCents?: number;
  readonly paidAt?: string;
}

function normalizePaymentEvent(payload: unknown): PaymentEvent {
  const p = payload as Record<string, unknown>;

  // Contrato dos fakes e retrocompatibilidade com integrações antigas.
  if (typeof p['eventType'] === 'string') {
    return {
      eventType: p['eventType'] === 'payment.confirmed'
        ? 'payment.confirmed'
        : p['eventType'] === 'payment.refunded'
          ? 'payment.refunded'
          : 'payment.ignored',
      sourceEvent: p['eventType'],
      ...(typeof p['paymentLinkId'] === 'string' ? { paymentLinkId: p['paymentLinkId'] } : {}),
      ...(typeof p['providerPaymentId'] === 'string'
        ? { providerPaymentId: p['providerPaymentId'] } : {}),
      ...(typeof p['amountCents'] === 'number' ? { amountCents: p['amountCents'] } : {}),
      ...(typeof p['paidAt'] === 'string' ? { paidAt: p['paidAt'] } : {}),
    };
  }

  // Asaas v3: { id, event, dateCreated, payment: { id, value, ... } }.
  const sourceEvent = typeof p['event'] === 'string' ? p['event'] : 'unknown';
  const payment = p['payment'] !== null && typeof p['payment'] === 'object'
    ? p['payment'] as Record<string, unknown>
    : {};
  const providerPaymentId = typeof payment['id'] === 'string' ? payment['id'] : undefined;
  const value = typeof payment['value'] === 'number' ? payment['value'] : undefined;

  let eventType: PaymentEventKind = 'payment.ignored';
  if (sourceEvent === 'PAYMENT_CONFIRMED' || sourceEvent === 'PAYMENT_RECEIVED') {
    eventType = 'payment.confirmed';
  } else if (sourceEvent === 'PAYMENT_REFUNDED') {
    eventType = 'payment.refunded';
  } else if (sourceEvent === 'PAYMENT_PARTIALLY_REFUNDED') {
    eventType = 'payment.partially_refunded';
  } else if (sourceEvent === 'PAYMENT_REFUND_IN_PROGRESS') {
    eventType = 'payment.refund_in_progress';
  } else if (sourceEvent === 'PAYMENT_REFUND_DENIED') {
    eventType = 'payment.refund_denied';
  } else if (sourceEvent === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') {
    eventType = 'payment.refunded';
  }

  return {
    eventType,
    sourceEvent,
    ...(providerPaymentId === undefined ? {} : { providerPaymentId }),
    ...(value === undefined ? {} : { amountCents: Math.round(value * 100) }),
    ...(typeof payment['confirmedDate'] === 'string'
      ? { paidAt: `${payment['confirmedDate']}T12:00:00.000Z` } : {}),
  };
}

export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => { done(null, body); },
  );

  r.post('/v1/payments/webhook', {
    schema: {
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
  }, async (req, reply) => {
    const rawBody = typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body));
    const headers = req.headers as Record<string, string>;

    const paymentProvider = providers().payment;
    const verificacao = paymentProvider.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    const rawPayload = JSON.parse(rawBody.toString('utf-8')) as unknown;
    const parsed = normalizePaymentEvent(rawPayload);

    // tenant_id nunca vem do webhook. Primeiro aceitamos o id local usado pelo
    // fake; em produção o Asaas envia payment.id, que corresponde a
    // fin.payment_link.provider_link_id.
    let tenantId: string | null = null;
    let paymentLinkId: string | null = null;
    let entryId: string | null = null;

    if (parsed.paymentLinkId !== undefined) {
      const { rows } = await jobsPool().query<{
        tenant_id: string; id: string; entry_id: string;
      }>(
        `SELECT tenant_id, id, entry_id FROM fin.payment_link WHERE id = $1`,
        [parsed.paymentLinkId],
      );
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        paymentLinkId = rows[0]!.id;
        entryId = rows[0]!.entry_id;
      }
    }

    if (tenantId === null && parsed.providerPaymentId !== undefined) {
      const { rows } = await jobsPool().query<{
        tenant_id: string; id: string; entry_id: string;
      }>(
        `SELECT tenant_id, id, entry_id
           FROM fin.payment_link
          WHERE provider_link_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [parsed.providerPaymentId],
      );
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        paymentLinkId = rows[0]!.id;
        entryId = rows[0]!.entry_id;
      }
    }

    if (tenantId === null && parsed.providerPaymentId !== undefined) {
      const { rows } = await jobsPool().query<{ tenant_id: string; id: string }>(
        `SELECT tenant_id, id FROM fin.entry WHERE external_ref = $1 LIMIT 1`,
        [parsed.providerPaymentId],
      );
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        entryId = rows[0]!.id;
      }
    }

    if (tenantId === null) {
      // O Asaas envia outros créditos da conta como PAYMENT_*. Só processamos
      // cobranças que conseguimos amarrar a um lançamento do Cadência.
      return { accepted: true as const };
    }

    const actor: Actor = {
      kind: 'system',
      tenantId,
      reason: 'webhook-psp-inbound',
      requestId: uuidv7(),
    };

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.webhook_event
           (id, event_type, raw_payload, received_at)
         VALUES ($1, $2, $3::jsonb, clock_timestamp())`,
        [uuidv7(), parsed.sourceEvent, rawBody.toString('utf-8')],
      );

      if (parsed.eventType === 'payment.confirmed' && entryId !== null) {
        const atualizado = await tx.query(
          `UPDATE fin.entry
              SET status = 'pago',
                  paid_at = coalesce($3::timestamptz, clock_timestamp()),
                  external_ref = coalesce($2, external_ref)
            WHERE id = $1 AND status = 'pendente'`,
          [entryId, parsed.providerPaymentId ?? null, parsed.paidAt ?? null],
        );

        // A transição pendente -> pago é a chave de idempotência. CONFIRMED e
        // RECEIVED podem chegar para a mesma cobrança e o Asaas pode reenviar
        // cada evento; recibo e split nascem exatamente uma vez.
        if (atualizado.rowCount === 0) return;

        await tx.query(
          `SELECT fin.calculate_splits(app.require_tenant_id(), $1)`,
          [entryId],
        );

        if (paymentLinkId !== null) {
          await tx.query(
            `UPDATE fin.payment_link
                SET status = 'paid',
                    paid_at = coalesce($3::timestamptz, clock_timestamp()),
                    webhook_raw = $2::jsonb,
                    updated_at = clock_timestamp()
              WHERE id = $1`,
            [paymentLinkId, rawBody.toString('utf-8'), parsed.paidAt ?? null],
          );
        }

        const { rows: counterRows } = await tx.query<{ consumed: string }>(
          `INSERT INTO fin.receipt_counter (tenant_id, next_value)
           VALUES (app.require_tenant_id(), 2)
           ON CONFLICT (tenant_id) DO UPDATE
             SET next_value = fin.receipt_counter.next_value + 1
           RETURNING next_value - 1 AS consumed`,
        );
        const receiptNumber = Number(counterRows[0]!.consumed);

        await tx.query(
          `INSERT INTO fin.receipt (id, entry_id, receipt_number)
           VALUES ($1, $2, $3)`,
          [uuidv7(), entryId, receiptNumber],
        );
        return;
      }

      if (entryId === null) return;

      if (parsed.eventType === 'payment.refunded') {
        await tx.query(
          `UPDATE fin.entry
              SET status = 'estornado',
                  external_ref = coalesce($2, external_ref)
            WHERE id = $1
              AND status IN ('pago', 'estorno_pendente', 'estorno_indeterminado', 'pendente')`,
          [entryId, parsed.providerPaymentId ?? null],
        );
        return;
      }

      if (parsed.eventType === 'payment.partially_refunded') {
        // O domínio ainda não representa estorno parcial. Marcar a receita toda
        // como estornada seria contabilmente falso; sinalizamos reconciliação.
        await tx.query(
          `UPDATE fin.entry
              SET status = 'estorno_indeterminado'
            WHERE id = $1 AND status IN ('pago', 'estorno_pendente')`,
          [entryId],
        );
        return;
      }

      if (parsed.eventType === 'payment.refund_in_progress') {
        await tx.query(
          `UPDATE fin.entry SET status = 'estorno_pendente'
            WHERE id = $1 AND status = 'pago'`,
          [entryId],
        );
        return;
      }

      if (parsed.eventType === 'payment.refund_denied') {
        await tx.query(
          `UPDATE fin.entry SET status = 'pago'
            WHERE id = $1 AND status IN ('estorno_pendente', 'estorno_indeterminado')`,
          [entryId],
        );
      }
    });

    return { accepted: true as const };
  });
}
