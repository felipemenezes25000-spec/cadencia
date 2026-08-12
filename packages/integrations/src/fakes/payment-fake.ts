import { createHmac } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentLinkInput, PaymentLinkResult, PaymentProvider,
  PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
  readonly webhookSecret?: string;
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const webhookSecret = opts.webhookSecret ?? 'fake-payment-secret';
  const pagamentos = new Map<string, PaymentSnapshot>();

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'PSP fake fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit_card', 'debit_card']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(ctx: ProviderCtx, i: PaymentLinkInput) {
      const f = falha<PaymentLinkResult>();
      if (f) return f;

      const providerPaymentId = `fake-pay-${ctx.idempotencyKey}`;
      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + i.expiresInMinutes * 60_000),
      ) ?? agora();

      const snapshot: PaymentSnapshot = {
        providerPaymentId,
        status: 'pending',
        amountCents: i.amountCents,
        paidAt: null,
        method: null,
        metadata: i.metadata ?? {},
      };
      pagamentos.set(providerPaymentId, snapshot);

      return success<PaymentLinkResult>({
        providerPaymentId,
        paymentUrl: `https://psp.fake/pay/${providerPaymentId}`,
        expiresAt,
      }, providerPaymentId);
    },

    async getPayment(_ctx: ProviderCtx, i) {
      const f = falha<PaymentSnapshot>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} não encontrado` });
      }
      return success(snap, i.providerPaymentId);
    },

    async refund(ctx: ProviderCtx, i) {
      const f = falha<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} não encontrado` });
      }

      const refundId = `fake-refund-${ctx.idempotencyKey}`;
      const refundedSnap: PaymentSnapshot = {
        ...snap,
        status: i.amountCents !== undefined && i.amountCents < snap.amountCents
          ? 'partially_refunded' : 'refunded',
      };
      pagamentos.set(i.providerPaymentId, refundedSnap);

      return success({ refundId, status: refundedSnap.status }, refundId);
    },

    verifyWebhook(raw: Buffer, h) {
      const sig = h['x-webhook-signature'];
      if (sig === undefined) {
        return { valid: false, reason: 'header x-webhook-signature ausente' };
      }
      const expected = createHmac('sha256', webhookSecret).update(raw).digest('hex');
      if (sig !== expected) {
        return { valid: false, reason: 'assinatura HMAC invalida' };
      }
      return { valid: true };
    },

    async fetchSettlements(_ctx: ProviderCtx, _i) {
      const f = falha<Settlement[]>();
      if (f) return f;

      const settlements: Settlement[] = [];
      for (const [, snap] of pagamentos) {
        if (snap.status === 'approved' || snap.status === 'refunded') {
          settlements.push({
            providerPaymentId: snap.providerPaymentId,
            grossCents: snap.amountCents,
            netCents: Math.round(snap.amountCents * 0.97),
            feeCents: Math.round(snap.amountCents * 0.03),
            settledAt: agora(),
          });
        }
      }
      return success(settlements, 'fake-settlements');
    },
  };
}
