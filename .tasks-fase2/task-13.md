### Task 13: fake MessagingProviderFake com gravacao de chamadas

**Arquivos**
- Criar `packages/integrations/src/fakes/messaging-fake.ts`
- Teste `packages/integrations/src/fakes/messaging-fake.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/fakes/messaging-fake.test.ts`:

```ts
// packages/integrations/src/fakes/messaging-fake.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeMessagingProvider } from './messaging-fake';
import { asE164, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'msg-1', deadlineMs: 3000,
};

const telefone = asE164('+5511987654321')!;

describe('provedor de mensageria falso', () => {
  it('declara channel whatsapp e supportsInbound true', () => {
    const p = createFakeMessagingProvider();
    expect(p.channel).toBe('whatsapp');
    expect(p.supportsInbound).toBe(true);
  });

  it('declara safety por metodo', () => {
    const p = createFakeMessagingProvider();
    expect(p.safety.registerChannelIdentity).toBe('idempotent');
    expect(p.safety.send).toBe('unsafe');
    expect(p.safety.findByIdempotencyKey).toBe('safe');
    expect(p.safety.verifyWebhook).toBe('safe');
    expect(p.safety.parseInbound).toBe('safe');
    expect(p.safety.fetchMedia).toBe('safe');
  });

  it('registerChannelIdentity devolve channelIdentityRef e status verified', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.registerChannelIdentity(ctx, {
      displayName: 'Clinica Exemplo',
      phone: telefone,
      wabaRef: 'waba-123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.channelIdentityRef).toContain('fake-identity');
      expect(r.value.status).toBe('verified');
    }
  });

  it('send grava a chamada e devolve providerMessageId', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: 'conv-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
    }
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body).toEqual({ kind: 'text', text: 'Lembrete de consulta' });
  });

  it('send com template grava templateName e variaveis', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: {
        kind: 'template',
        templateName: 'confirmacao_consulta',
        language: 'pt_BR',
        variables: ['Maria', '14/08', '10:00'],
      },
      conversationId: 'conv-2',
    });
    expect(r.ok).toBe(true);
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body.kind).toBe('template');
  });

  it('findByIdempotencyKey devolve null quando nao existe', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.findByIdempotencyKey(ctx, { key: 'inexistente' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('findByIdempotencyKey devolve o providerMessageId apos send', async () => {
    const p = createFakeMessagingProvider();
    await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-3',
    });
    const r = await p.findByIdempotencyKey(ctx, { key: ctx.idempotencyKey });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toBeNull();
    if (r.ok && r.value) expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
  });

  it('verifyWebhook aceita HMAC-SHA256 valido e rejeita invalido', () => {
    const p = createFakeMessagingProvider({ appSecret: 'meu-secret' });
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', 'meu-secret').update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };

    expect(p.verifyWebhook(payload, headers)).toEqual({ valid: true });
    expect(p.verifyWebhook(payload, { 'x-hub-signature-256': 'sha256=errado' }))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('parseInbound extrai mensagem de texto do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.abc',
              from: '5511987654321',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Confirmo' },
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('message');
    if (eventos[0]!.kind === 'message') {
      expect(eventos[0]!.body).toEqual({ kind: 'text', text: 'Confirmo' });
      expect(eventos[0]!.from).toBe('+5511987654321');
    }
  });

  it('parseInbound extrai status update do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.xyz',
              status: 'delivered',
              timestamp: '1722772801',
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('status');
    if (eventos[0]!.kind === 'status') {
      expect(eventos[0]!.status).toBe('delivered');
    }
  });

  it('fetchMedia devolve bytes e sha256', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.fetchMedia(ctx, { providerMediaId: 'media-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
      expect(r.value.mime).toBe('image/jpeg');
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  it('o modo indisponivel devolve unavailable em send', async () => {
    const p = createFakeMessagingProvider({ modo: 'indisponivel' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-4',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-5',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });

  it('health reporta up quando modo e ok', async () => {
    const p = createFakeMessagingProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health reporta down quando modo nao e ok', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/fakes/messaging-fake.test.ts
# ESPERADO: falha — modulo './messaging-fake' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/fakes/messaging-fake.ts`:

```ts
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

export type ModoFakeMsg = 'ok' | 'indisponivel' | 'timeout';

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
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/fakes/messaging-fake.test.ts
# ESPERADO: 13 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/fakes/messaging-fake.ts packages/integrations/src/fakes/messaging-fake.test.ts
git commit -m "feat(integrations): add MessagingProviderFake with call recording

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---