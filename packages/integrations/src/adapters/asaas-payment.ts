import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentLinkInput, PaymentLinkResult, PaymentProvider,
  PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

export interface AsaasConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly webhookToken: string;
}

const PROD_URL = 'https://api.asaas.com/v3';

function mapStatus(s: string): PaymentStatus {
  switch (s) {
    case 'PENDING': case 'AWAITING_RISK_ANALYSIS': return 'pending';
    case 'CONFIRMED': case 'RECEIVED': case 'RECEIVED_IN_CASH': return 'approved';
    case 'DECLINED': return 'declined';
    case 'REFUNDED': return 'refunded';
    case 'PARTIALLY_REFUNDED': return 'partially_refunded';
    case 'OVERDUE': case 'DELETED': return 'cancelled';
    default: return 'indeterminate';
  }
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

async function asaasRequest<T>(
  base: string, path: string, apiKey: string, ctx: ProviderCtx,
  opts: { method?: string; body?: unknown } = {},
): Promise<ProviderResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'access_token': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'cadencia/1.0',
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after') ?? '5') * 1000;
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: after,
        detail: 'rate limit' });
    }
    if (res.status >= 500) {
      return failure({ kind: 'unavailable', retrySafe: true,
        detail: `asaas ${res.status}` });
    }
    const json = await res.json() as T & { errors?: Array<{ description: string }> };
    if (!res.ok) {
      const detail = (json as { errors?: Array<{ description: string }> })
        .errors?.map((e) => e.description).join('; ') ?? `status ${res.status}`;
      return failure({ kind: 'rejected', retrySafe: false,
        code: `ASAAS_${res.status}`, detail });
    }
    return success(json as T, (json as { id?: string }).id ?? '');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return failure({ kind: 'timeout', retrySafe: false, detail: `deadline ${ctx.deadlineMs}ms` });
    }
    return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
  } finally {
    clearTimeout(timer);
  }
}

export function createAsaasPaymentProvider(cfg: AsaasConfig): PaymentProvider {
  const base = cfg.baseUrl ?? PROD_URL;

  return {
    id: 'payment-asaas',
    capabilities: new Set(['residency:br', 'pix', 'credit_card', 'boleto']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      const t0 = systemClock.nowMs();
      let up = false;
      try {
        const res = await fetch(`${base}/finance/getCurrentBalance`, {
          headers: { 'access_token': cfg.apiKey },
          signal: AbortSignal.timeout(5000),
        });
        up = res.ok;
      } catch { /* offline */ }
      return { up, latencyMs: systemClock.nowMs() - t0, checkedAt: agora() };
    },

    async createPaymentLink(ctx: ProviderCtx, i: PaymentLinkInput) {
      const dueDate = new Date(systemClock.nowMs() + i.expiresInMinutes * 60_000)
        .toISOString().slice(0, 10);

      const r = await asaasRequest<{
        id: string; invoiceUrl: string; dueDate: string;
      }>(base, '/payments', cfg.apiKey, ctx, {
        method: 'POST',
        body: {
          billingType: 'UNDEFINED',
          value: i.amountCents / 100,
          dueDate,
          description: i.description,
          externalReference: ctx.idempotencyKey,
          ...(i.customerEmail !== undefined ? { email: i.customerEmail } : {}),
        },
      });
      if (!r.ok) return r;

      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + i.expiresInMinutes * 60_000),
      ) ?? agora();
      return success<PaymentLinkResult>({
        providerPaymentId: r.value.id,
        paymentUrl: r.value.invoiceUrl,
        expiresAt,
      }, r.value.id);
    },

    async getPayment(ctx: ProviderCtx, i) {
      const r = await asaasRequest<{
        id: string; status: string; value: number;
        confirmedDate: string | null; billingType: string;
        externalReference: string | null;
      }>(base, `/payments/${i.providerPaymentId}`, cfg.apiKey, ctx);
      if (!r.ok) return r;
      return success<PaymentSnapshot>({
        providerPaymentId: r.value.id,
        status: mapStatus(r.value.status),
        amountCents: Math.round(r.value.value * 100),
        paidAt: r.value.confirmedDate
          ? asRfc3339(`${r.value.confirmedDate}T12:00:00.000Z`) : null,
        method: r.value.billingType?.toLowerCase() ?? null,
        metadata: r.value.externalReference
          ? { externalReference: r.value.externalReference } : {},
      }, r.value.id);
    },

    async refund(ctx: ProviderCtx, i) {
      const body = i.amountCents !== undefined ? { value: i.amountCents / 100 } : {};
      const r = await asaasRequest<{ id: string; status: string }>(
        base, `/payments/${i.providerPaymentId}/refund`, cfg.apiKey, ctx,
        { method: 'POST', body },
      );
      if (!r.ok) return r;
      return success({
        refundId: r.value.id,
        status: mapStatus(r.value.status),
      }, r.value.id);
    },

    verifyWebhook(_raw: Buffer, h) {
      const token = h['asaas-access-token'];
      if (token === undefined) {
        return { valid: false, reason: 'header asaas-access-token ausente' };
      }
      if (token !== cfg.webhookToken) {
        return { valid: false, reason: 'token de webhook invalido' };
      }
      return { valid: true };
    },

    async fetchSettlements(ctx: ProviderCtx, i) {
      const r = await asaasRequest<{
        data: Array<{
          payment: string; value: number; netValue: number; fee: number;
          settlementDate: string;
        }>;
      }>(
        base,
        `/financialTransactions?startDate=${i.from.slice(0, 10)}&finishDate=${i.to.slice(0, 10)}&type=PAYMENT`,
        cfg.apiKey, ctx,
      );
      if (!r.ok) return r;
      return success<Settlement[]>(
        r.value.data.map((t) => ({
          providerPaymentId: t.payment,
          grossCents: Math.round(t.value * 100),
          netCents: Math.round(t.netValue * 100),
          feeCents: Math.round(Math.abs(t.fee) * 100),
          settledAt: (asRfc3339(`${t.settlementDate}T12:00:00.000Z`) ?? agora()),
        })),
        'asaas-settlements',
      );
    },
  };
}
