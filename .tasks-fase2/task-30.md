### Task 30: contrato PaymentProvider e tipos auxiliares em packages/integrations

**Arquivos**
- Criar `packages/integrations/src/contracts/payment.ts`
- Criar `packages/integrations/src/contracts/payment.test.ts`
- Modificar `packages/integrations/src/index.ts`

**Por que primeiro:** o contrato e a fundacao de tudo neste bloco — sem ele nao existe fake, nao existe job de link, nao existe webhook. Segue o padrao exato de `signature.ts` e `prescription.ts`.

- [ ] Criar o arquivo de contrato `packages/integrations/src/contracts/payment.ts` com os tipos e a interface:

```ts
// packages/integrations/src/contracts/payment.ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export const PAYMENT_STATUSES = [
  'pending', 'paid', 'expired', 'cancelled', 'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(v: string): v is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(v);
}

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly feeCents: number | null;
  readonly method: string | null;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly feeCents: number;
  readonly netCents: number;
  readonly settledAt: Rfc3339;
  readonly originalPaidAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(ctx: ProviderCtx, i: {
    amountCents: number;
    description: string;
    expiresAt?: Rfc3339;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ linkId: string; url: string; expiresAt: Rfc3339 }>>;

  getPayment(ctx: ProviderCtx, i: { providerPaymentId: string }):
    Promise<ProviderResult<PaymentSnapshot>>;

  refund(ctx: ProviderCtx, i: {
    providerPaymentId: string;
    amountCents?: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(raw: Buffer, headers: Record<string, string>):
    { valid: boolean; reason?: string };

  fetchSettlements(ctx: ProviderCtx, i: { from: Rfc3339; to: Rfc3339 }):
    Promise<ProviderResult<Settlement[]>>;
}
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` e confirmar que o arquivo de teste ainda nao existe (erro esperado: arquivo nao encontrado).

- [ ] Criar o arquivo de teste `packages/integrations/src/contracts/payment.test.ts`:

```ts
// packages/integrations/src/contracts/payment.test.ts
import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES, isPaymentStatus } from './payment';

describe('status de pagamento', () => {
  it('enumera os cinco estados do ciclo de vida de um link', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'pending', 'paid', 'expired', 'cancelled', 'refunded',
    ]);
  });

  it('aceita status valido e recusa invalido em runtime', () => {
    expect(isPaymentStatus('paid')).toBe(true);
    expect(isPaymentStatus('aprovado')).toBe(false);
  });
});
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` — dois testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/contracts/payment.test.ts (2 tests)
 Tests  2 passed
```

- [ ] Adicionar as exportacoes em `packages/integrations/src/index.ts`:

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
  PAYMENT_STATUSES, isPaymentStatus,
  type PaymentProvider, type PaymentSnapshot, type PaymentStatus,
  type Settlement,
} from './contracts/payment';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` — dois testes passam (o export do fake sera criado na Task 31; o `index.ts` acima sera atualizado apos a Task 31 para que compile).

**Nota:** o `index.ts` acima inclui a exportacao do fake que sera criado na Task 31. Ate la, a compilacao falha — isso e esperado. A ordem de commit segue o TDD: este commit so inclui `payment.ts`, `payment.test.ts` e a parte de `index.ts` que compila. A linha do fake e adicionada no commit da Task 31.

Commit: `feat(integrations): add PaymentProvider contract with status types`

---