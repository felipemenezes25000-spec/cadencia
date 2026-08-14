// packages/integrations/src/fakes/sms-fake.ts
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type E164, type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  InboundEvent, MessagingProvider, OutboundBody,
} from '../contracts/messaging';

export type ModoFakeSms = 'ok' | 'indisponivel' | 'timeout' | 'bloqueado';

export interface FakeSmsOptions {
  readonly modo?: ModoFakeSms;
}

export interface SentSmsRecord {
  readonly ctx: ProviderCtx;
  readonly channelIdentityRef: string;
  readonly to: E164 | string;
  readonly body: OutboundBody;
  readonly conversationId: string;
  readonly providerMessageId: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeSmsProvider(
  opts: FakeSmsOptions = {},
): MessagingProvider & { readonly sent: readonly SentSmsRecord[] } {
  const modo = opts.modo ?? 'ok';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'SMS fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false,
                          detail: 'deadline estourou' });
    }
    if (modo === 'bloqueado') {
      return failure<T>({ kind: 'rejected', retrySafe: false,
                          code: 'CHANNEL_SUSPENDED',
                          detail: 'canal suspenso — numero bloqueado pelo parceiro' });
    }
    return null;
  }

  const sentList: SentSmsRecord[] = [];
  const sentByKey = new Map<string, string>();
  let counter = 0;

  return {
    id: 'messaging-sms-fake',
    channel: 'sms' as const,
    supportsInbound: false,
    capabilities: new Set(['residency:br']),
    safety: {
      registerChannelIdentity: 'idempotent',
      send: 'unsafe',
      findByIdempotencyKey: 'safe',
      verifyWebhook: 'safe',
      parseInbound: 'safe',
      fetchMedia: 'safe',
    },

    get sent(): readonly SentSmsRecord[] {
      return sentList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async registerChannelIdentity(_ctx: ProviderCtx, i) {
      const f = falha<{ channelIdentityRef: string; status: 'pending' | 'verified' | 'rejected' }>();
      if (f) return f;
      const ref = `fake-sms-identity-${i.phone}`;
      return success({ channelIdentityRef: ref, status: 'verified' as const }, ref);
    },

    async send(ctx: ProviderCtx, i) {
      const f = falha<{ providerMessageId: string }>();
      if (f) return f;

      const existing = sentByKey.get(ctx.idempotencyKey);
      if (existing !== undefined) {
        return success({ providerMessageId: existing }, existing);
      }

      counter += 1;
      const providerMessageId = `smsid-fake-${counter}`;
      sentList.push({
        ctx,
        channelIdentityRef: i.channelIdentityRef,
        to: i.to,
        body: i.body,
        conversationId: i.conversationId,
        providerMessageId,
      });
      sentByKey.set(ctx.idempotencyKey, providerMessageId);
      return success({ providerMessageId }, providerMessageId);
    },

    async findByIdempotencyKey(_ctx: ProviderCtx, i) {
      const f = falha<{ providerMessageId: string } | null>();
      if (f) return f;
      const found = sentByKey.get(i.key);
      if (found === undefined) {
        return success(null, 'fake-lookup-null');
      }
      return success({ providerMessageId: found }, found);
    },

    verifyWebhook() {
      return { valid: false as const, reason: 'SMS nao suporta webhook inbound' };
    },

    parseInbound(): InboundEvent[] {
      return [];
    },

    async fetchMedia() {
      return failure<{ bytes: Uint8Array; mime: string; sha256: string }>(
        { kind: 'unsupported', retrySafe: false, detail: 'SMS nao suporta midia' },
      );
    },
  };
}
