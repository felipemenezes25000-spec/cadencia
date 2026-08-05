### Task 31: fake PaymentProviderFake e teste de conformidade

**Arquivos**
- Criar `packages/integrations/src/fakes/payment-fake.ts`
- Criar `packages/integrations/src/fakes/payment-fake.test.ts`
- Modificar `packages/integrations/src/conformance.test.ts`
- Modificar `packages/integrations/src/index.ts`

- [ ] Criar o fake `packages/integrations/src/fakes/payment-fake.ts`:

```ts
// packages/integrations/src/fakes/payment-fake.ts
import { createHmac } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentProvider, PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

const SEGREDO = 'cadencia-fake-payment-do-not-use-in-production';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout' | 'rejeitado';
  readonly agora?: () => Rfc3339;
  /** Simula webhook de pagamento confirmado — getPayment devolve paid. */
  readonly simularPago?: boolean;
}

function agoraPadrao(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs()))
    ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

function deterministico(rotulo: string, chave: string): string {
  return createHmac('sha256', SEGREDO).update(`${rotulo}:${chave}`).digest('hex').slice(0, 24);
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const agora = opts.agora ?? agoraPadrao;
  const pagamentos = new Map<string, PaymentSnapshot>();

  function talvezFalhar<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                       detail: 'PSP fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure({ kind: 'timeout', retrySafe: false,
                       detail: 'deadline de 3s estourou' });
    }
    if (modo === 'rejeitado') {
      return failure({ kind: 'rejected', retrySafe: false, code: 'LIMITE_EXCEDIDO',
                       detail: 'valor acima do limite do lojista' });
    }
    return null;
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit-card', 'boleto']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(_ctx: ProviderCtx, i) {
      const f = talvezFalhar<{ linkId: string; url: string; expiresAt: Rfc3339 }>();
      if (f) return f;
      const linkId = deterministico('link', i.idempotencyKey);
      const expira = i.expiresAt
        ?? (asRfc3339(isoFromMs(systemClock.nowMs() + 24 * 60 * 60_000)) ?? agora());
      const snapshot: PaymentSnapshot = {
        providerPaymentId: linkId,
        status: opts.simularPago === true ? 'paid' : 'pending',
        amountCents: i.amountCents,
        paidAt: opts.simularPago === true ? agora() : null,
        feeCents: opts.simularPago === true ? Math.round(i.amountCents * 0.0199) : null,
        method: opts.simularPago === true ? 'pix' : null,
      };
      pagamentos.set(linkId, snapshot);
      return success(
        { linkId, url: `https://psp.fake/pay/${linkId}`, expiresAt: expira },
        `fake-link-${linkId}`,
      );
    },

    async getPayment(_ctx, i) {
      const f = talvezFalhar<PaymentSnapshot>();
      if (f) return f;
      const snap = pagamentos.get(i.providerPaymentId);
      if (snap !== undefined) {
        return success(snap, `fake-get-${i.providerPaymentId}`);
      }
      return success<PaymentSnapshot>({
        providerPaymentId: i.providerPaymentId,
        status: opts.simularPago === true ? 'paid' : 'pending',
        amountCents: 0,
        paidAt: opts.simularPago === true ? agora() : null,
        feeCents: opts.simularPago === true ? 0 : null,
        method: opts.simularPago === true ? 'pix' : null,
      }, `fake-get-${i.providerPaymentId}`);
    },

    async refund(_ctx, i) {
      const f = talvezFalhar<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;
      const refundId = deterministico('refund', i.idempotencyKey);
      return success(
        { refundId, status: 'refunded' as const },
        `fake-refund-${refundId}`,
      );
    },

    verifyWebhook(_raw: Buffer, headers: Record<string, string>) {
      const sig = headers['x-psp-signature'];
      if (sig === undefined || sig === '') {
        return { valid: false, reason: 'assinatura ausente' };
      }
      return { valid: sig === 'fake-valid-signature', reason: undefined };
    },

    async fetchSettlements(_ctx, i) {
      const f = talvezFalhar<Settlement[]>();
      if (f) return f;
      const items: Settlement[] = [];
      for (const [id, snap] of pagamentos) {
        if (snap.status === 'paid' && snap.paidAt !== null) {
          items.push({
            providerPaymentId: id,
            grossCents: snap.amountCents,
            feeCents: snap.feeCents ?? 0,
            netCents: snap.amountCents - (snap.feeCents ?? 0),
            settledAt: agora(),
            originalPaidAt: snap.paidAt,
          });
        }
      }
      return success(items, `fake-settlements-${i.from}-${i.to}`);
    },
  };
}
```

- [ ] Rodar `npx vitest run packages/integrations/src/fakes/payment-fake.test.ts` — confirmar que o arquivo de teste ainda nao existe (erro esperado).

- [ ] Criar o teste `packages/integrations/src/fakes/payment-fake.test.ts`:

```ts
// packages/integrations/src/fakes/payment-fake.test.ts
import { describe, expect, it } from 'vitest';
import { createFakePaymentProvider } from './payment-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'pay-1', deadlineMs: 3000,
};

describe('provedor de pagamento falso', () => {
  it('declara safety por metodo — createPaymentLink e idempotent, refund e unsafe', () => {
    const p = createFakePaymentProvider();
    expect(p.safety.createPaymentLink).toBe('idempotent');
    expect(p.safety.getPayment).toBe('safe');
    expect(p.safety.refund).toBe('unsafe');
    expect(p.safety.fetchSettlements).toBe('safe');
  });

  it('createPaymentLink devolve linkId, url e expiresAt', async () => {
    const p = createFakePaymentProvider();
    const r = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta Dr. Alceu',
      idempotencyKey: 'idem-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.linkId).toBeTruthy();
      expect(r.value.url).toMatch(/^https:\/\//);
      expect(r.value.expiresAt).toMatch(/Z$/);
    }
  });

  it('e idempotente: a mesma chave devolve o MESMO linkId', async () => {
    const p = createFakePaymentProvider();
    const a = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta', idempotencyKey: 'idem-2',
    });
    const b = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta', idempotencyKey: 'idem-2',
    });
    if (a.ok && b.ok) {
      expect(a.value.linkId).toBe(b.value.linkId);
    }
  });

  it('getPayment devolve snapshot do link criado', async () => {
    const p = createFakePaymentProvider({ simularPago: true });
    const link = await p.createPaymentLink(ctx, {
      amountCents: 15000, description: 'Retorno', idempotencyKey: 'idem-3',
    });
    if (!link.ok) throw new Error('nao criou link');
    const snap = await p.getPayment(ctx, { providerPaymentId: link.value.linkId });
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(snap.value.status).toBe('paid');
      expect(snap.value.paidAt).toBeTruthy();
      expect(snap.value.feeCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('refund devolve refundId e status refunded', async () => {
    const p = createFakePaymentProvider();
    const r = await p.refund(ctx, {
      providerPaymentId: 'link-x', reason: 'paciente desistiu',
      idempotencyKey: 'ref-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.refundId).toBeTruthy();
      expect(r.value.status).toBe('refunded');
    }
  });

  it('verifyWebhook aceita assinatura valida e recusa ausente', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), { 'x-psp-signature': 'fake-valid-signature' }).valid)
      .toBe(true);
    expect(p.verifyWebhook(Buffer.from('{}'), {}).valid).toBe(false);
  });

  it('fetchSettlements devolve liquidacoes dos pagamentos confirmados', async () => {
    const p = createFakePaymentProvider({ simularPago: true });
    await p.createPaymentLink(ctx, {
      amountCents: 30000, description: 'Procedimento', idempotencyKey: 'idem-settle',
    });
    const r = await p.fetchSettlements(ctx, {
      from: '2026-01-01T00:00:00.000Z' as any,
      to: '2026-12-31T23:59:59.999Z' as any,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeGreaterThanOrEqual(1);
      const s = r.value[0]!;
      expect(s.grossCents).toBe(30000);
      expect(s.netCents).toBe(s.grossCents - s.feeCents);
    }
  });

  it('o modo indisponivel devolve unavailable — e retryable', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx, {
      amountCents: 10000, description: 'T', idempotencyKey: 'idem-fail',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx, {
      amountCents: 10000, description: 'T', idempotencyKey: 'idem-fail-2',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });
});
```

- [ ] Rodar `npx vitest run packages/integrations/src/fakes/payment-fake.test.ts` — oito testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/fakes/payment-fake.test.ts (8 tests)
 Tests  8 passed
```

- [ ] Adicionar o PaymentProvider ao teste de conformidade em `packages/integrations/src/conformance.test.ts`:

```ts
// packages/integrations/src/conformance.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';
import { createFakePaymentProvider } from './fakes/payment-fake';

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
    expect(assertSafetyDeclared(createFakePaymentProvider(),
      ['createPaymentLink', 'getPayment', 'refund', 'fetchSettlements'])).toBe(true);
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
});
```

- [ ] Atualizar `packages/integrations/src/index.ts` adicionando as exportacoes do payment (o arquivo completo ja foi mostrado na Task 30 com as linhas do fake — agora que o fake existe, o arquivo compila).

- [ ] Rodar `npx vitest run packages/integrations/src/conformance.test.ts` — quatro testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/conformance.test.ts (4 tests)
 Tests  4 passed
```

- [ ] Rodar `npx vitest run packages/integrations/` — todos os testes do pacote passam (14 testes no total).

Commit: `feat(integrations): add PaymentProviderFake with conformance tests`

---