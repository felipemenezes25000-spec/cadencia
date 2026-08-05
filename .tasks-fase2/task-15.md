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