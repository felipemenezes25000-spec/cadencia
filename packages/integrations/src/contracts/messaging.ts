// packages/integrations/src/contracts/messaging.ts
import type { E164, Provider, ProviderCtx, ProviderResult } from './common';

export type OutboundBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'template'; readonly templateName: string;
      readonly language: string; readonly variables: readonly string[] };

export type InboundMessageBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly providerMediaId: string;
      readonly mime: string; readonly caption?: string }
  | { readonly kind: 'audio'; readonly providerMediaId: string;
      readonly mime: string }
  | { readonly kind: 'document'; readonly providerMediaId: string;
      readonly mime: string; readonly filename?: string };

export interface InboundMessage {
  readonly kind: 'message';
  readonly providerMessageId: string;
  readonly from: string;
  readonly timestamp: string;
  readonly body: InboundMessageBody;
}

export interface StatusUpdate {
  readonly kind: 'status';
  readonly providerMessageId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly timestamp: string;
  readonly errorCode?: string;
  readonly errorDetail?: string;
}

export type InboundEvent = InboundMessage | StatusUpdate;

export interface WebhookVerificationContext {
  /** URL pública exata usada pelo parceiro para calcular a assinatura. */
  readonly url?: string;
}

export interface MessagingProvider extends Provider {
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly supportsInbound: boolean;

  registerChannelIdentity(
    ctx: ProviderCtx,
    i: { displayName: string; phone: E164; wabaRef?: string },
  ): Promise<ProviderResult<{
    channelIdentityRef: string;
    status: 'pending' | 'verified' | 'rejected';
  }>>;

  send(
    ctx: ProviderCtx,
    i: {
      channelIdentityRef: string;
      to: E164 | string;
      body: OutboundBody;
      conversationId: string;
    },
  ): Promise<ProviderResult<{ providerMessageId: string }>>;

  findByIdempotencyKey(
    ctx: ProviderCtx,
    i: { key: string },
  ): Promise<ProviderResult<{ providerMessageId: string } | null>>;

  verifyWebhook(
    raw: Buffer,
    headers: Record<string, string>,
    context?: WebhookVerificationContext,
  ): { valid: boolean; reason?: string };

  parseInbound(raw: Buffer): InboundEvent[];

  fetchMedia(
    ctx: ProviderCtx,
    i: { providerMediaId: string },
  ): Promise<ProviderResult<{ bytes: Uint8Array; mime: string; sha256: string }>>;
}
