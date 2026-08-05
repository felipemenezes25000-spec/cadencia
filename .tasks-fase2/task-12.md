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