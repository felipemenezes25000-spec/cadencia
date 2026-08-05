### Task 27: PaymentProvider — contrato e fake — **SUPERSEDED pelo Bloco 06**

> **COLISAO RESOLVIDA**: o contrato PaymentProvider deste bloco e SUPERSEDED
> pelo Bloco 06 (Task 30). Diferencas:
> - PaymentStatus: este bloco tem 7 valores, Bloco 06 tem 5 (vence Bloco 06)
> - PaymentSnapshot: este bloco tem metadata, Bloco 06 tem feeCents/method (vence Bloco 06)
> - createPaymentLink: Bloco 06 adiciona idempotencyKey (vence Bloco 06)
> - createFakePaymentProvider: Bloco 06 tem mais modos de falha (vence Bloco 06)
>
> Este bloco deve OMITIR a criacao de `payment.ts` e `payment-fake.ts` nos
> arquivos de integrations e usar a versao do Bloco 06.
> As funcoes de dominio (recordPayment, cancelPayment, etc.) e os testes
> de unidade PERMANECEM validos — usam o contrato, nao o definem.

**Arquivos**

- Criar `packages/integrations/src/contracts/payment.ts`
- Criar `packages/integrations/src/fakes/payment-fake.ts`
- Criar `packages/integrations/src/fakes/payment-fake.test.ts`
- Modificar `packages/integrations/src/index.ts`

**Passos**

- [ ] Criar o contrato em `packages/integrations/src/contracts/payment.ts`:

```ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export type PaymentStatus =
  | 'pending' | 'approved' | 'declined' | 'refunded'
  | 'partially_refunded' | 'cancelled' | 'indeterminate';

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly method: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly netCents: number;
  readonly feeCents: number;
  readonly settledAt: Rfc3339;
}

export interface PaymentLinkInput {
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes: number;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentLinkResult {
  readonly providerPaymentId: string;
  readonly paymentUrl: string;
  readonly expiresAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(
    ctx: ProviderCtx,
    i: PaymentLinkInput,
  ): Promise<ProviderResult<PaymentLinkResult>>;

  getPayment(
    ctx: ProviderCtx,
    i: { providerPaymentId: string },
  ): Promise<ProviderResult<PaymentSnapshot>>;

  refund(
    ctx: ProviderCtx,
    i: { providerPaymentId: string; amountCents?: number; reason: string },
  ): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(
    raw: Buffer,
    h: Record<string, string>,
  ): { valid: boolean; reason?: string };

  /** Conciliacao: taxa REAL vem do PSP; nunca calculamos por conta propria. */
  fetchSettlements(
    ctx: ProviderCtx,
    i: { from: Rfc3339; to: Rfc3339 },
  ): Promise<ProviderResult<Settlement[]>>;
}
```

- [ ] Criar o fake em `packages/integrations/src/fakes/payment-fake.ts`:

```ts
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentLinkInput, PaymentLinkResult, PaymentProvider,
  PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const pagamentos = new Map<string, PaymentSnapshot>();

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'PSP fake fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit_card', 'debit_card']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(ctx: ProviderCtx, i: PaymentLinkInput) {
      const f = falha<PaymentLinkResult>();
      if (f) return f;

      const providerPaymentId = `fake-pay-${ctx.idempotencyKey}`;
      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + i.expiresInMinutes * 60_000),
      ) ?? agora();

      const snapshot: PaymentSnapshot = {
        providerPaymentId,
        status: 'pending',
        amountCents: i.amountCents,
        paidAt: null,
        method: null,
        metadata: i.metadata ?? {},
      };
      pagamentos.set(providerPaymentId, snapshot);

      return success<PaymentLinkResult>({
        providerPaymentId,
        paymentUrl: `https://psp.fake/pay/${providerPaymentId}`,
        expiresAt,
      }, providerPaymentId);
    },

    async getPayment(_ctx: ProviderCtx, i) {
      const f = falha<PaymentSnapshot>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }
      return success(snap, i.providerPaymentId);
    },

    async refund(ctx: ProviderCtx, i) {
      const f = falha<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }

      const refundId = `fake-refund-${ctx.idempotencyKey}`;
      const refundedSnap: PaymentSnapshot = {
        ...snap,
        status: i.amountCents !== undefined && i.amountCents < snap.amountCents
          ? 'partially_refunded' : 'refunded',
      };
      pagamentos.set(i.providerPaymentId, refundedSnap);

      return success({ refundId, status: refundedSnap.status }, refundId);
    },

    verifyWebhook(_raw: Buffer, _h) {
      return { valid: true };
    },

    async fetchSettlements(_ctx: ProviderCtx, _i) {
      const f = falha<Settlement[]>();
      if (f) return f;

      const settlements: Settlement[] = [];
      for (const [, snap] of pagamentos) {
        if (snap.status === 'approved' || snap.status === 'refunded') {
          settlements.push({
            providerPaymentId: snap.providerPaymentId,
            grossCents: snap.amountCents,
            netCents: Math.round(snap.amountCents * 0.97),
            feeCents: Math.round(snap.amountCents * 0.03),
            settledAt: agora(),
          });
        }
      }
      return success(settlements, 'fake-settlements');
    },
  };
}
```

- [ ] Criar o teste em `packages/integrations/src/fakes/payment-fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafetyDeclared } from '../conformance';
import { type ProviderCtx } from '../contracts/common';
import { createFakePaymentProvider } from './payment-fake';

function ctx(key: string): ProviderCtx {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorUserId: '00000000-0000-0000-0000-000000000002',
    requestId: '00000000-0000-0000-0000-000000000003',
    idempotencyKey: key,
    deadlineMs: 5000,
  };
}

describe('PaymentProvider fake', () => {
  it('declara safety para todos os metodos', () => {
    const p = createFakePaymentProvider();
    expect(assertSafetyDeclared(p, [
      'createPaymentLink', 'getPayment', 'refund', 'fetchSettlements',
    ])).toBe(true);
  });

  it('cria link, consulta e estorna', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('link-1'), {
      amountCents: 25000,
      description: 'Consulta particular',
      expiresInMinutes: 30,
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.value.paymentUrl).toContain('fake-pay-link-1');

    const get = await p.getPayment(ctx('get-1'), {
      providerPaymentId: link.value.providerPaymentId,
    });
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.status).toBe('pending');
      expect(get.value.amountCents).toBe(25000);
    }

    const refund = await p.refund(ctx('refund-1'), {
      providerPaymentId: link.value.providerPaymentId,
      reason: 'paciente desistiu',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('refunded');
    }
  });

  it('modo indisponivel retorna unavailable com retrySafe', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx('indisp-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unavailable');
      expect(r.error.retrySafe).toBe(true);
    }
  });

  it('modo timeout retorna timeout sem retrySafe — ESTADO DESCONHECIDO', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx('timeout-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  it('health retorna up=false quando indisponivel', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('verifyWebhook do fake sempre retorna valido', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), {})).toEqual({ valid: true });
  });

  it('estorno parcial marca como partially_refunded', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('partial-1'), {
      amountCents: 25000,
      description: 'Consulta',
      expiresInMinutes: 30,
    });
    if (!link.ok) return;

    const refund = await p.refund(ctx('partial-ref-1'), {
      providerPaymentId: link.value.providerPaymentId,
      amountCents: 10000,
      reason: 'estorno parcial',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('partially_refunded');
    }
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/fakes/payment-fake.test.ts
```

Saida esperada: 7 testes passando.

- [ ] Atualizar o barrel `packages/integrations/src/index.ts` para exportar o contrato e o fake:

```ts
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
  type PaymentLinkInput, type PaymentLinkResult, type PaymentProvider,
  type PaymentSnapshot, type PaymentStatus, type Settlement,
} from './contracts/payment';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
```

- [ ] Rodar todos os testes de unidade do integrations para garantir que nada quebrou:

```bash
pnpm vitest run packages/integrations/src/
```

Saida esperada: todos os testes passando.

---