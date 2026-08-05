import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export type PaymentStatus =
  | 'pending' | 'approved' | 'declined' | 'refunded'
  | 'partially_refunded' | 'cancelled' | 'indeterminate';

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly method: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly netCents: number;
  readonly feeCents: number;
  readonly settledAt: Rfc3339;
}

export interface PaymentLinkInput {
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes: number;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentLinkResult {
  readonly providerPaymentId: string;
  readonly paymentUrl: string;
  readonly expiresAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(
    ctx: ProviderCtx,
    i: PaymentLinkInput,
  ): Promise<ProviderResult<PaymentLinkResult>>;

  getPayment(
    ctx: ProviderCtx,
    i: { providerPaymentId: string },
  ): Promise<ProviderResult<PaymentSnapshot>>;

  refund(
    ctx: ProviderCtx,
    i: { providerPaymentId: string; amountCents?: number; reason: string },
  ): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(
    raw: Buffer,
    h: Record<string, string>,
  ): { valid: boolean; reason?: string };

  /** Conciliacao: taxa REAL vem do PSP; nunca calculamos por conta propria. */
  fetchSettlements(
    ctx: ProviderCtx,
    i: { from: Rfc3339; to: Rfc3339 },
  ): Promise<ProviderResult<Settlement[]>>;
}
