import { createHash } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { InboundEvent, MessagingProvider } from '../contracts/messaging';
import {
  buildSendPayload, buildTemplateSendPayload,
  parseWhatsAppInbound, verifyWhatsAppWebhook,
} from './whatsapp-cloud';

export interface WhatsAppCloudConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly appSecret: string;
  readonly apiVersion?: string;
}

const GRAPH_BASE = 'https://graph.facebook.com';

async function graphRequest<T>(
  url: string, token: string, ctx: ProviderCtx,
  opts: { method?: string; body?: unknown; raw?: boolean } = {},
): Promise<ProviderResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'cadencia/1.0',
    };
    if (!opts.raw) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 60_000,
        detail: 'rate limit' });
    }
    if (res.status >= 500) {
      return failure({ kind: 'unavailable', retrySafe: true, detail: `graph ${res.status}` });
    }
    if (opts.raw) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const mime = res.headers.get('content-type') ?? 'application/octet-stream';
      return success({ bytes, mime, sha256 } as T, sha256);
    }
    const json = await res.json() as T;
    if (!res.ok) {
      const detail = (json as { error?: { message?: string } }).error?.message
        ?? `status ${res.status}`;
      return failure({ kind: 'rejected', retrySafe: false, code: `WA_${res.status}`, detail });
    }
    return success(json, '');
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

export function createWhatsAppCloudProvider(cfg: WhatsAppCloudConfig): MessagingProvider {
  const ver = cfg.apiVersion ?? 'v21.0';
  const base = `${GRAPH_BASE}/${ver}`;

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'messaging-whatsapp-cloud',
    channel: 'whatsapp',
    supportsInbound: true,
    capabilities: new Set(['residency:br', 'text', 'template', 'media_download']),
    safety: {
      registerChannelIdentity: 'idempotent',
      send: 'unsafe',
      findByIdempotencyKey: 'safe',
      fetchMedia: 'safe',
    },

    async health() {
      const t0 = systemClock.nowMs();
      let up = false;
      try {
        const res = await fetch(`${base}/${cfg.phoneNumberId}`, {
          headers: { 'Authorization': `Bearer ${cfg.accessToken}` },
          signal: AbortSignal.timeout(5000),
        });
        up = res.ok;
      } catch { /* offline */ }
      return { up, latencyMs: systemClock.nowMs() - t0, checkedAt: agora() };
    },

    async registerChannelIdentity(ctx, _i) {
      const r = await graphRequest<{ success: boolean }>(
        `${base}/${cfg.phoneNumberId}/register`, cfg.accessToken, ctx,
        { method: 'POST', body: { messaging_product: 'whatsapp', pin: '000000' } },
      );
      if (!r.ok) return r;
      return success({
        channelIdentityRef: cfg.phoneNumberId,
        status: 'verified' as const,
      }, cfg.phoneNumberId);
    },

    async send(ctx, i) {
      const payload = i.body.kind === 'template'
        ? buildTemplateSendPayload(i.to, i.body)
        : buildSendPayload(i.to, i.body);

      const r = await graphRequest<{ messages: Array<{ id: string }> }>(
        `${base}/${i.channelIdentityRef}/messages`, cfg.accessToken, ctx,
        { method: 'POST', body: payload },
      );
      if (!r.ok) return r;
      const messageId = r.value.messages?.[0]?.id ?? '';
      return success({ providerMessageId: messageId }, messageId);
    },

    async findByIdempotencyKey(_ctx, _i) {
      return success(null, '');
    },

    verifyWebhook(raw, headers) {
      return verifyWhatsAppWebhook(raw, headers, cfg.appSecret);
    },

    parseInbound(raw): InboundEvent[] {
      return parseWhatsAppInbound(raw);
    },

    async fetchMedia(ctx, i) {
      const metaR = await graphRequest<{ url: string }>(
        `${base}/${i.providerMediaId}`, cfg.accessToken, ctx,
      );
      if (!metaR.ok) return metaR;
      return graphRequest(metaR.value.url, cfg.accessToken, ctx, { raw: true });
    },
  };
}
