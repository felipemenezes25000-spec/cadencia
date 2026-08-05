// packages/integrations/src/fakes/messaging-fake.ts
import { createHash, createHmac } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type E164, type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  InboundEvent, InboundMessage, InboundMessageBody, MessagingProvider,
  OutboundBody, StatusUpdate,
} from '../contracts/messaging';

export type ModoFakeMsg = 'ok' | 'indisponivel' | 'timeout' | 'bloqueado';

export interface FakeMessagingOptions {
  readonly modo?: ModoFakeMsg;
  readonly appSecret?: string;
}

export interface SentRecord {
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

export function createFakeMessagingProvider(
  opts: FakeMessagingOptions = {},
): MessagingProvider & { readonly sent: readonly SentRecord[] } {
  const modo = opts.modo ?? 'ok';
  const appSecret = opts.appSecret ?? 'fake-whatsapp-secret';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'WhatsApp Cloud API fake indisponivel' });
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

  const sentList: SentRecord[] = [];
  const sentByKey = new Map<string, string>();
  let counter = 0;

  return {
    id: 'messaging-whatsapp-fake',
    channel: 'whatsapp' as const,
    supportsInbound: true,
    capabilities: new Set(['residency:br', 'inbound', 'templates']),
    safety: {
      registerChannelIdentity: 'idempotent',
      send: 'unsafe',
      findByIdempotencyKey: 'safe',
      verifyWebhook: 'safe',
      parseInbound: 'safe',
      fetchMedia: 'safe',
    },

    get sent(): readonly SentRecord[] {
      return sentList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async registerChannelIdentity(_ctx: ProviderCtx, i) {
      const f = falha<{ channelIdentityRef: string; status: 'pending' | 'verified' | 'rejected' }>();
      if (f) return f;
      const ref = `fake-identity-${i.phone}`;
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
      const providerMessageId = `wamid-fake-${counter}`;
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

    verifyWebhook(raw: Buffer, headers: Record<string, string>) {
      const sig = headers['x-hub-signature-256'];
      if (sig === undefined) {
        return { valid: false, reason: 'header x-hub-signature-256 ausente' };
      }
      const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
      if (sig !== expected) {
        return { valid: false, reason: 'assinatura HMAC invalida' };
      }
      return { valid: true };
    },

    parseInbound(raw: Buffer): InboundEvent[] {
      const parsed = JSON.parse(raw.toString('utf-8')) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              messages?: Array<{
                id: string; from: string; timestamp: string; type: string;
                text?: { body: string };
                image?: { id: string; mime_type: string; caption?: string };
                audio?: { id: string; mime_type: string };
                document?: { id: string; mime_type: string; filename?: string };
              }>;
              statuses?: Array<{
                id: string; status: string; timestamp: string;
                errors?: Array<{ code: number; title: string }>;
              }>;
            };
          }>;
        }>;
      };

      const events: InboundEvent[] = [];

      for (const entry of parsed.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (value === undefined) continue;

          for (const msg of value.messages ?? []) {
            let body: InboundMessageBody;
            switch (msg.type) {
              case 'text':
                body = { kind: 'text', text: msg.text?.body ?? '' };
                break;
              case 'image':
                body = {
                  kind: 'image',
                  providerMediaId: msg.image!.id,
                  mime: msg.image!.mime_type,
                  ...(msg.image!.caption !== undefined ? { caption: msg.image!.caption } : {}),
                };
                break;
              case 'audio':
                body = {
                  kind: 'audio',
                  providerMediaId: msg.audio!.id,
                  mime: msg.audio!.mime_type,
                };
                break;
              case 'document':
                body = {
                  kind: 'document',
                  providerMediaId: msg.document!.id,
                  mime: msg.document!.mime_type,
                  ...(msg.document!.filename !== undefined
                    ? { filename: msg.document!.filename } : {}),
                };
                break;
              default:
                continue;
            }

            const ts = Number(msg.timestamp) * 1000;
            const inbound: InboundMessage = {
              kind: 'message',
              providerMessageId: msg.id,
              from: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
              timestamp: isoFromMs(ts),
              body,
            };
            events.push(inbound);
          }

          for (const st of value.statuses ?? []) {
            const mapped = st.status as StatusUpdate['status'];
            if (!['sent', 'delivered', 'read', 'failed'].includes(mapped)) continue;
            const ts = Number(st.timestamp) * 1000;
            const status: StatusUpdate = {
              kind: 'status',
              providerMessageId: st.id,
              status: mapped,
              timestamp: isoFromMs(ts),
              ...(st.errors?.[0] !== undefined ? {
                errorCode: String(st.errors[0].code),
                errorDetail: st.errors[0].title,
              } : {}),
            };
            events.push(status);
          }
        }
      }

      return events;
    },

    async fetchMedia(_ctx: ProviderCtx, i) {
      const f = falha<{ bytes: Uint8Array; mime: string; sha256: string }>();
      if (f) return f;
      const bytes = new TextEncoder().encode(`fake-media-${i.providerMediaId}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return success({ bytes: new Uint8Array(bytes), mime: 'image/jpeg', sha256 },
        `fake-media-${i.providerMediaId}`);
    },
  };
}
