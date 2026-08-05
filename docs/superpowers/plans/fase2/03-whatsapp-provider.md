<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. Task 17 (migration 0073) REMOVIDA — msg.channel_identity ja e
     criada pela migration 0070 do Bloco 02. Os testes de Task 17
     devem referenciar a tabela existente (coluna phone, nao phone_number).
  2. FakeMessagingProvider.createIdentity ja usa phone — OK.
  3. O barrel index.ts de integrations e unificado no Bloco 06.
─────────────────────────────────────────────────────────────────── -->

### Task 12: contrato MessagingProvider e tipos auxiliares

**Arquivos**
- Criar `packages/integrations/src/contracts/messaging.ts`
- Teste `packages/integrations/src/contracts/messaging.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/contracts/messaging.test.ts`:

```ts
// packages/integrations/src/contracts/messaging.test.ts
import { describe, expect, it } from 'vitest';
import type {
  MessagingProvider, OutboundBody, InboundEvent, InboundMessage, StatusUpdate,
} from './messaging';

describe('tipos do contrato MessagingProvider', () => {
  it('OutboundBody aceita texto simples', () => {
    const body: OutboundBody = { kind: 'text', text: 'Ola' };
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Ola');
  });

  it('OutboundBody aceita template com variaveis', () => {
    const body: OutboundBody = {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08', '10:00'],
    };
    expect(body.kind).toBe('template');
    expect(body.variables).toHaveLength(3);
  });

  it('InboundEvent discrimina mensagem de status update', () => {
    const msg: InboundEvent = {
      kind: 'message',
      providerMessageId: 'wamid.abc',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'text', text: 'Confirmo' },
    } satisfies InboundMessage;
    expect(msg.kind).toBe('message');

    const status: InboundEvent = {
      kind: 'status',
      providerMessageId: 'wamid.abc',
      status: 'delivered',
      timestamp: '2026-08-04T10:00:01.000Z',
    } satisfies StatusUpdate;
    expect(status.kind).toBe('status');
  });

  it('InboundMessage aceita corpo de midia com providerMediaId', () => {
    const msg: InboundMessage = {
      kind: 'message',
      providerMessageId: 'wamid.xyz',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'image', providerMediaId: 'media-123', mime: 'image/jpeg', caption: 'exame' },
    };
    expect(msg.body.kind).toBe('image');
  });

  it('StatusUpdate cobre sent, delivered, read e failed', () => {
    const statuses: StatusUpdate['status'][] = ['sent', 'delivered', 'read', 'failed'];
    expect(statuses).toHaveLength(4);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: falha — modulo './messaging' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/contracts/messaging.ts`:

```ts
// packages/integrations/src/contracts/messaging.ts
import type { E164, Provider, ProviderCtx, ProviderResult } from './common';

// ── Outbound body ──────────────────────────────────────────────────────

export type OutboundBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'template'; readonly templateName: string;
      readonly language: string; readonly variables: readonly string[] };

// ── Inbound events ─────────────────────────────────────────────────────

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
  readonly from: string;          // E164 bruto do parceiro
  readonly timestamp: string;     // Rfc3339 bruto do parceiro
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

// ── Contrato principal ─────────────────────────────────────────────────

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
  ): { valid: boolean; reason?: string };

  parseInbound(raw: Buffer): InboundEvent[];

  fetchMedia(
    ctx: ProviderCtx,
    i: { providerMediaId: string },
  ): Promise<ProviderResult<{ bytes: Uint8Array; mime: string; sha256: string }>>;
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: 5 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/contracts/messaging.ts packages/integrations/src/contracts/messaging.test.ts
git commit -m "feat(integrations): add MessagingProvider contract and auxiliary types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

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

### Task 14: conformidade obrigatoria — MessagingProvider no teste de conformidade

**Arquivos**
- Modificar `packages/integrations/src/conformance.test.ts`

- [ ] **Teste que falha** — adicionar ao `packages/integrations/src/conformance.test.ts`, dentro do `describe('conformidade obrigatoria por adaptador')`:

```ts
// packages/integrations/src/conformance.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';
import { createFakeMessagingProvider } from './fakes/messaging-fake';
import { asE164, type ProviderCtx } from './contracts/common';

const msgCtx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'conformidade-msg', deadlineMs: 3000,
};

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
    expect(assertSafetyDeclared(createFakeMessagingProvider(),
      ['registerChannelIdentity', 'send', 'findByIdempotencyKey',
       'verifyWebhook', 'parseInbound', 'fetchMedia'])).toBe(true);
  });

  it('reprova provedor que esqueceu de declarar a safety de um metodo', () => {
    const p = createFakeSignatureProvider();
    expect(() => assertSafetyDeclared(p, ['metodoInexistente']))
      .toThrow(/safety nao declarada para metodoInexistente/);
  });

  it('timeout com efeito NAO duplica: a segunda chamada devolve o MESMO resultado', async () => {
    let chamadas = 0;
    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        return chamadas === 1 ? { estado: 'timeout' as const } : { estado: 'ok' as const, id: 'X' };
      },
      reconciliar: async () => ({ jaExiste: true, id: 'X' }),
    });
    expect(r).toEqual({ duplicou: false, id: 'X', viaReconciliacao: true });
  });

  it('reprova o adaptador que reenvia cegamente apos timeout', async () => {
    await expect(assertNoDuplicateOnTimeout({
      operacao: async () => ({ estado: 'ok' as const, id: `novo-${Math.random()}` }),
      reconciliar: async () => ({ jaExiste: false, id: null }),
      simularEfeitoNoTimeout: true,
    })).rejects.toThrow(/duplicou/);
  });

  it('messaging: timeout em send NAO duplica graças a findByIdempotencyKey', async () => {
    const p = createFakeMessagingProvider();
    const phone = asE164('+5511987654321')!;
    let chamadas = 0;

    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        if (chamadas === 1) {
          // simula: a primeira chamada funciona mas o caller ve timeout
          await p.send(msgCtx, {
            channelIdentityRef: 'id-1', to: phone,
            body: { kind: 'text', text: 'lembrete' },
            conversationId: 'conv-conf',
          });
          return { estado: 'timeout' as const };
        }
        // segunda chamada: o caller tenta de novo com a mesma idempotencyKey
        const r2 = await p.send(msgCtx, {
          channelIdentityRef: 'id-1', to: phone,
          body: { kind: 'text', text: 'lembrete' },
          conversationId: 'conv-conf',
        });
        if (!r2.ok) return { estado: 'timeout' as const };
        return { estado: 'ok' as const, id: r2.value.providerMessageId };
      },
      reconciliar: async () => {
        const found = await p.findByIdempotencyKey(msgCtx, { key: msgCtx.idempotencyKey });
        if (found.ok && found.value !== null) {
          return { jaExiste: true, id: found.value.providerMessageId };
        }
        return { jaExiste: false, id: null };
      },
    });

    expect(r.duplicou).toBe(false);
    expect(r.viaReconciliacao).toBe(true);
    // o fake so enviou UMA vez, nao duplicou
    expect(p.sent).toHaveLength(1);
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/conformance.test.ts
# ESPERADO: 5 testes passam (incluindo o novo de messaging)
```

- [ ] Commitar:

```bash
git add packages/integrations/src/conformance.test.ts
git commit -m "test(integrations): add MessagingProvider to conformance tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 15: exportar contrato e fake no barrel do pacote

**Arquivos**
- Modificar `packages/integrations/src/index.ts`
- Teste `packages/integrations/src/contracts/messaging.test.ts` (ja existe, roda como regressao)

- [ ] **Teste que falha** — criar teste de importacao via barrel. Adicionar ao final de `packages/integrations/src/contracts/messaging.test.ts`:

```ts
// Adicionar ao final do describe existente em
// packages/integrations/src/contracts/messaging.test.ts

  it('exporta tipos e fake pelo barrel do pacote', async () => {
    const barrel = await import('../index');
    expect(barrel.createFakeMessagingProvider).toBeTypeOf('function');
  });
```

O `describe` completo fica:

```ts
// packages/integrations/src/contracts/messaging.test.ts
import { describe, expect, it } from 'vitest';
import type {
  MessagingProvider, OutboundBody, InboundEvent, InboundMessage, StatusUpdate,
} from './messaging';

describe('tipos do contrato MessagingProvider', () => {
  it('OutboundBody aceita texto simples', () => {
    const body: OutboundBody = { kind: 'text', text: 'Ola' };
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Ola');
  });

  it('OutboundBody aceita template com variaveis', () => {
    const body: OutboundBody = {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08', '10:00'],
    };
    expect(body.kind).toBe('template');
    expect(body.variables).toHaveLength(3);
  });

  it('InboundEvent discrimina mensagem de status update', () => {
    const msg: InboundEvent = {
      kind: 'message',
      providerMessageId: 'wamid.abc',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'text', text: 'Confirmo' },
    } satisfies InboundMessage;
    expect(msg.kind).toBe('message');

    const status: InboundEvent = {
      kind: 'status',
      providerMessageId: 'wamid.abc',
      status: 'delivered',
      timestamp: '2026-08-04T10:00:01.000Z',
    } satisfies StatusUpdate;
    expect(status.kind).toBe('status');
  });

  it('InboundMessage aceita corpo de midia com providerMediaId', () => {
    const msg: InboundMessage = {
      kind: 'message',
      providerMessageId: 'wamid.xyz',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'image', providerMediaId: 'media-123', mime: 'image/jpeg', caption: 'exame' },
    };
    expect(msg.body.kind).toBe('image');
  });

  it('StatusUpdate cobre sent, delivered, read e failed', () => {
    const statuses: StatusUpdate['status'][] = ['sent', 'delivered', 'read', 'failed'];
    expect(statuses).toHaveLength(4);
  });

  it('exporta tipos e fake pelo barrel do pacote', async () => {
    const barrel = await import('../index');
    expect(barrel.createFakeMessagingProvider).toBeTypeOf('function');
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: falha no ultimo teste — createFakeMessagingProvider nao exportado pelo barrel
```

- [ ] **Implementar** — modificar `packages/integrations/src/index.ts`, adicionando as exportacoes de messaging:

```ts
// packages/integrations/src/index.ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  type MessagingProvider, type OutboundBody, type InboundEvent,
  type InboundMessage, type InboundMessageBody, type StatusUpdate,
} from './contracts/messaging';
export {
  createFakeMessagingProvider, type FakeMessagingOptions, type ModoFakeMsg, type SentRecord,
} from './fakes/messaging-fake';
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: 6 testes passam (incluindo o de barrel)
```

- [ ] Commitar:

```bash
git add packages/integrations/src/index.ts packages/integrations/src/contracts/messaging.test.ts
git commit -m "feat(integrations): export MessagingProvider contract and fake from barrel

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 16: adaptador WhatsApp Cloud API — estrutura e webhook

**Arquivos**
- Criar `packages/integrations/src/adapters/whatsapp-cloud.ts`
- Teste `packages/integrations/src/adapters/whatsapp-cloud.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/adapters/whatsapp-cloud.test.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyWhatsAppWebhook,
  parseWhatsAppInbound,
  buildSendPayload,
  buildTemplateSendPayload,
} from './whatsapp-cloud';
import type { InboundMessage, StatusUpdate } from '../contracts/messaging';

const APP_SECRET = 'test-app-secret-1234';

describe('WhatsApp Cloud API — webhook e parsing', () => {
  it('verifyWhatsAppWebhook aceita assinatura HMAC-SHA256 valida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: true });
  });

  it('verifyWhatsAppWebhook rejeita assinatura invalida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const headers = { 'x-hub-signature-256': 'sha256=invalido' };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('verifyWhatsAppWebhook rejeita quando header ausente', () => {
    const payload = Buffer.from('{"entry":[]}');
    expect(verifyWhatsAppWebhook(payload, {}, APP_SECRET))
      .toEqual({ valid: false, reason: 'header x-hub-signature-256 ausente' });
  });

  it('parseWhatsAppInbound extrai mensagem de texto', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.HBgN',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Boa tarde, confirmo a consulta' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.kind).toBe('message');
    expect(msg.providerMessageId).toBe('wamid.HBgN');
    expect(msg.from).toBe('+5511999887766');
    expect(msg.body).toEqual({ kind: 'text', text: 'Boa tarde, confirmo a consulta' });
  });

  it('parseWhatsAppInbound extrai mensagem de imagem com caption', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'image',
              image: { id: 'media-img-1', mime_type: 'image/jpeg', caption: 'exame de sangue' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('image');
    if (msg.body.kind === 'image') {
      expect(msg.body.providerMediaId).toBe('media-img-1');
      expect(msg.body.caption).toBe('exame de sangue');
    }
  });

  it('parseWhatsAppInbound extrai mensagem de audio', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.AUD1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'audio',
              audio: { id: 'media-aud-1', mime_type: 'audio/ogg; codecs=opus' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('audio');
  });

  it('parseWhatsAppInbound extrai mensagem de documento', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.DOC1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'document',
              document: { id: 'media-doc-1', mime_type: 'application/pdf', filename: 'laudo.pdf' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('document');
    if (msg.body.kind === 'document') {
      expect(msg.body.filename).toBe('laudo.pdf');
    }
  });

  it('parseWhatsAppInbound extrai status updates', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid.S1', status: 'sent', timestamp: '1722772800' },
              { id: 'wamid.S1', status: 'delivered', timestamp: '1722772801' },
              { id: 'wamid.S1', status: 'read', timestamp: '1722772805' },
            ],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(3);
    expect((events[0] as StatusUpdate).status).toBe('sent');
    expect((events[1] as StatusUpdate).status).toBe('delivered');
    expect((events[2] as StatusUpdate).status).toBe('read');
  });

  it('parseWhatsAppInbound extrai status failed com codigo de erro', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.F1', status: 'failed', timestamp: '1722772800',
              errors: [{ code: 131026, title: 'Message Undeliverable' }],
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const st = events[0] as StatusUpdate;
    expect(st.status).toBe('failed');
    expect(st.errorCode).toBe('131026');
    expect(st.errorDetail).toBe('Message Undeliverable');
  });

  it('parseWhatsAppInbound devolve array vazio para payload sem mensagens', () => {
    const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('parseWhatsAppInbound ignora tipos de mensagem desconhecidos', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.UNK', from: '5511999887766', timestamp: '1722772800',
              type: 'sticker', sticker: { id: 'stk-1' },
            }],
          },
        }],
      }],
    }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('buildSendPayload monta o corpo para envio de texto via Cloud API', () => {
    const payload = buildSendPayload('+5511987654321', { kind: 'text', text: 'Ola, bom dia!' });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'text',
      text: { preview_url: false, body: 'Ola, bom dia!' },
    });
  });

  it('buildTemplateSendPayload monta o corpo para envio de template', () => {
    const payload = buildTemplateSendPayload('+5511987654321', {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08/2026', '10:00'],
    });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'template',
      template: {
        name: 'confirmacao_consulta',
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '14/08/2026' },
            { type: 'text', text: '10:00' },
          ],
        }],
      },
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: falha — modulo './whatsapp-cloud' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/adapters/whatsapp-cloud.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.ts
import { createHmac } from 'node:crypto';
import { isoFromMs } from '@cadencia/kernel';
import type { InboundEvent, InboundMessage, InboundMessageBody, OutboundBody, StatusUpdate } from '../contracts/messaging';

/**
 * §7.3 — funcoes puras do adaptador WhatsApp Cloud API v21+.
 *
 * Estas funcoes NAO fazem chamadas HTTP — elas transformam dados.
 * A chamada HTTP real sai exclusivamente pelo worker via outbox (§7.1).
 *
 * O adaptador completo (que implementa MessagingProvider) vive no
 * pacote de messaging e usa estas funcoes como building blocks.
 */

// ── Verificacao de webhook ─────────────────────────────────────────────

export function verifyWhatsAppWebhook(
  raw: Buffer,
  headers: Record<string, string>,
  appSecret: string,
): { valid: boolean; reason?: string } {
  const sig = headers['x-hub-signature-256'];
  if (sig === undefined) {
    return { valid: false, reason: 'header x-hub-signature-256 ausente' };
  }
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  if (sig !== expected) {
    return { valid: false, reason: 'assinatura HMAC invalida' };
  }
  return { valid: true };
}

// ── Parsing de inbound ─────────────────────────────────────────────────

interface RawWhatsAppPayload {
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
}

export function parseWhatsAppInbound(raw: Buffer): InboundEvent[] {
  const parsed: RawWhatsAppPayload = JSON.parse(raw.toString('utf-8'));
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
}

// ── Construcao de payload de envio ─────────────────────────────────────

export interface CloudApiTextPayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'text';
  readonly text: { readonly preview_url: false; readonly body: string };
}

export interface CloudApiTemplatePayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'template';
  readonly template: {
    readonly name: string;
    readonly language: { readonly code: string };
    readonly components: readonly [{
      readonly type: 'body';
      readonly parameters: readonly Array<{ readonly type: 'text'; readonly text: string }>;
    }];
  };
}

export function buildSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'text' }>,
): CloudApiTextPayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: body.text },
  };
}

export function buildTemplateSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'template' }>,
): CloudApiTemplatePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: body.templateName,
      language: { code: body.language },
      components: [{
        type: 'body',
        parameters: body.variables.map((v) => ({ type: 'text' as const, text: v })),
      }],
    },
  };
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: 12 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/adapters/whatsapp-cloud.ts packages/integrations/src/adapters/whatsapp-cloud.test.ts
git commit -m "feat(integrations): WhatsApp Cloud API adapter — webhook verify, inbound parse, send payload

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### ~~Task 17: migration 0073 — tabela msg.channel_identity~~ REMOVIDA

> **COLISAO RESOLVIDA**: esta migration duplica a criacao de `msg.channel_identity`
> que ja e feita pela migration 0070 (Bloco 02, Task 6). A migration 0073 NAO
> deve ser criada. Os testes de integracao desta task devem validar a tabela
> existente (criada por 0070) usando a coluna `phone` (nao `phone_number`).
> O arquivo `0073_msg_channel_identity.sql` NAO deve ser criado.

### Task 17: testes de integracao de `msg.channel_identity` e WABA onboarding

**Arquivos**
- Criar `packages/db/migrations/0073_msg_channel_identity.sql`
- Teste `packages/db/test/0073_msg_channel_identity.test.ts`

- [ ] **Teste que falha** — criar `packages/db/test/0073_msg_channel_identity.test.ts`:

```ts
// packages/db/test/0073_msg_channel_identity.test.ts
import { describe, expect, it } from 'vitest';
import { withTenantTx } from '../src/tx';
import { testPool, TEST_TENANT_ID, TEST_USER_ID } from './helpers';

const actor = { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, role: 'admin' as const };

describe('msg.channel_identity', () => {
  it('a tabela msg.channel_identity existe no schema msg', async () => {
    const result = await testPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'msg' AND table_name = 'channel_identity'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('insere identidade de canal com tenant_id e RLS permite leitura do mesmo tenant', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone, waba_ref,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica Teste',
          '+5511987654321', 'waba-123', 'prov-ref-1', 'verified',
          $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      const result = await tx.query(
        'SELECT channel, display_name, phone, status FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        channel: 'whatsapp',
        display_name: 'Clinica Teste',
        phone: '+5511987654321',
        status: 'verified',
      });
    });
  });

  it('RLS impede leitura de canal de OUTRO tenant', async () => {
    const outroTenant = { tenantId: '00000000-0000-0000-0000-000000000099', userId: TEST_USER_ID, role: 'admin' as const };
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Outra Clinica',
          '+5511911111111', 'prov-ref-2', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);
    });

    await withTenantTx(outroTenant, async (tx) => {
      const result = await tx.query(
        'SELECT * FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it('constraint unique (tenant_id, channel, phone) impede duplicata', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A',
          '+5511922222222', 'prov-ref-3', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      await expect(tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A Duplicada',
          '+5511922222222', 'prov-ref-4', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID])).rejects.toThrow(/unique|duplicate/i);
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: falha — schema msg e tabela channel_identity nao existem
```

- [ ] **Implementar** — criar `packages/db/migrations/0073_msg_channel_identity.sql`:

```sql
-- 0073_msg_channel_identity.sql
-- Schema msg para mensageria. Tabela channel_identity: identidade de canal
-- por tenant (numero WhatsApp, telefone SMS, email).
-- Cada clinica registra o proprio numero — nunca compartilhado.

BEGIN;

CREATE SCHEMA IF NOT EXISTS msg;

CREATE TABLE msg.channel_identity (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  channel    text        NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  display_name text      NOT NULL,
  phone      text        NOT NULL,          -- E164
  waba_ref   text,                          -- WABA ID da Meta, opcional
  provider_ref text      NOT NULL,          -- referencia do provedor
  status     text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verified', 'rejected', 'suspended')),
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT uq_channel_identity_phone UNIQUE (tenant_id, channel, phone)
);

-- RLS: isolamento multi-tenant
ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON msg.channel_identity
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

COMMENT ON TABLE msg.channel_identity IS
  '§7.3 — identidade de canal por tenant. O numero e PROPRIO da clinica.';

COMMIT;
```

- [ ] Rodar as migrations:

```bash
pnpm db:migrate
# ESPERADO: migration 0073 aplicada com sucesso
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: 4 testes passam
```

- [ ] Rodar suite de isolamento para confirmar que a nova tabela esta coberta:

```bash
pnpm test:iso
# ESPERADO: msg.channel_identity aparece e passa
```

- [ ] Commitar:

```bash
git add packages/db/migrations/0073_msg_channel_identity.sql packages/db/test/0073_msg_channel_identity.test.ts
git commit -m "feat(db): add msg schema and channel_identity table with RLS

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
