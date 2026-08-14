import { createHmac, timingSafeEqual } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { InboundEvent, InboundMessage, MessagingProvider, StatusUpdate } from '../contracts/messaging';

export interface TwilioSmsConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createTwilioSmsProvider(cfg: TwilioSmsConfig): MessagingProvider {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}`;
  const authHeader = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');

  async function twilioRequest<T>(
    path: string, ctx: ProviderCtx,
    opts: { method?: string; form?: Record<string, string> } = {},
  ): Promise<ProviderResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
    try {
      const headers: Record<string, string> = {
        'Authorization': authHeader,
        'User-Agent': 'cadencia/1.0',
      };
      let body: string | undefined;
      if (opts.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(opts.form).toString();
      }
      const res = await fetch(`${base}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
      if (res.status === 429) {
        return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 10_000,
          detail: 'rate limit' });
      }
      if (res.status >= 500) {
        return failure({ kind: 'unavailable', retrySafe: true, detail: `twilio ${res.status}` });
      }
      const json = await res.json() as T;
      if (!res.ok) {
        const detail = (json as { message?: string }).message ?? `status ${res.status}`;
        return failure({ kind: 'rejected', retrySafe: false,
          code: `TWILIO_${res.status}`, detail });
      }
      return success(json, (json as { sid?: string }).sid ?? '');
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

  return {
    id: 'messaging-twilio-sms',
    channel: 'sms',
    supportsInbound: true,
    capabilities: new Set(['residency:br', 'text']),
    safety: {
      registerChannelIdentity: 'safe',
      send: 'unsafe',
      findByIdempotencyKey: 'safe',
      fetchMedia: 'safe',
    },

    async health() {
      const t0 = systemClock.nowMs();
      let up = false;
      try {
        const res = await fetch(`${base}.json`, {
          headers: { 'Authorization': authHeader },
          signal: AbortSignal.timeout(5000),
        });
        up = res.ok;
      } catch { /* offline */ }
      return { up, latencyMs: systemClock.nowMs() - t0, checkedAt: agora() };
    },

    async registerChannelIdentity(_ctx, _i) {
      return success({
        channelIdentityRef: cfg.fromNumber,
        status: 'verified' as const,
      }, cfg.fromNumber);
    },

    async send(ctx, i) {
      if (i.body.kind !== 'text') {
        return failure({ kind: 'unsupported', retrySafe: false,
          detail: 'SMS Twilio so suporta texto' });
      }
      const r = await twilioRequest<{ sid: string }>(
        '/Messages.json', ctx,
        {
          method: 'POST',
          form: {
            To: i.to,
            From: cfg.fromNumber,
            Body: i.body.text,
          },
        },
      );
      if (!r.ok) return r;
      return success({ providerMessageId: r.value.sid }, r.value.sid);
    },

    async findByIdempotencyKey(_ctx, _i) {
      return success(null, '');
    },

    verifyWebhook(raw, headers) {
      const sig = headers['x-twilio-signature'];
      if (sig === undefined) {
        return { valid: false, reason: 'header x-twilio-signature ausente' };
      }
      const expected = createHmac('sha1', cfg.authToken).update(raw).digest('base64');
      try {
        const valid = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        return valid ? { valid: true } : { valid: false, reason: 'HMAC invalido' };
      } catch {
        return { valid: false, reason: 'tamanho de assinatura incompativel' };
      }
    },

    parseInbound(raw): InboundEvent[] {
      const params = new URLSearchParams(raw.toString('utf-8'));
      const sid = params.get('MessageSid') ?? params.get('SmsSid');
      const from = params.get('From');
      const body = params.get('Body');
      const status = params.get('MessageStatus');

      if (sid && status && !body) {
        const mapped = status === 'delivered' ? 'delivered'
          : status === 'sent' ? 'sent'
          : status === 'failed' || status === 'undelivered' ? 'failed'
          : null;
        if (mapped) {
          const su: StatusUpdate = {
            kind: 'status', providerMessageId: sid, status: mapped,
            timestamp: isoFromMs(systemClock.nowMs()),
          };
          return [su];
        }
      }

      if (sid && from && body) {
        const msg: InboundMessage = {
          kind: 'message', providerMessageId: sid,
          from: from.startsWith('+') ? from : `+${from}`,
          timestamp: isoFromMs(systemClock.nowMs()),
          body: { kind: 'text', text: body },
        };
        return [msg];
      }

      return [];
    },

    async fetchMedia(_ctx, _i) {
      return failure({ kind: 'unsupported', retrySafe: false,
        detail: 'SMS nao suporta download de media' });
    },
  };
}
