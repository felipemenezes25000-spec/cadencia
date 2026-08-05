### Task 59: adicionar msg ao TENANT_SCHEMAS e atualizar providers registry

**Arquivos**

- Modificar `packages/db/src/invariants/catalog.ts`
- Criar `packages/db/src/invariants/catalog.test.ts`
- Modificar `apps/api/src/providers.ts`
- Criar `apps/api/src/providers.test.ts`

**Passos**

- [ ] Escrever o teste que afirma que `msg` e `fin` pertencem ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas da Fase 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que falha porque `msg` nao esta em `TENANT_SCHEMAS`.

Saida esperada: 1 falha — `msg` nao encontrado.

- [ ] Adicionar `msg` ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.ts — so a linha que muda
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg'] as const;
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Escrever o teste do registry de providers incluindo messaging e payment.

```ts
// apps/api/src/providers.test.ts
import { describe, expect, it } from 'vitest';
import { providers, type Providers } from './providers';

describe('registry de providers (fake)', () => {
  it('inclui signature, prescription, messaging e payment', () => {
    const p: Providers = providers();
    expect(p.signature.id).toBe('signature-fake');
    expect(p.prescription.id).toBe('prescription-fake');
    expect(p.messaging.id).toBe('messaging-fake');
    expect(p.payment.id).toBe('payment-fake');
  });

  it('todos declaram safety para seus metodos', () => {
    const p = providers();
    expect(Object.keys(p.messaging.safety).length).toBeGreaterThan(0);
    expect(Object.keys(p.payment.safety).length).toBeGreaterThan(0);
  });

  it('todos declaram capabilities', () => {
    const p = providers();
    expect(p.messaging.capabilities.size).toBeGreaterThan(0);
    expect(p.payment.capabilities.size).toBeGreaterThan(0);
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que falha porque `messaging` e `payment` nao existem no registry.

Saida esperada: falha de tipo/propriedade.

- [ ] Atualizar o registry de providers para incluir messaging e payment.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  type MessagingProvider, type PaymentProvider,
  type PrescriptionProvider, type SignatureProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
    payment: createFakePaymentProvider(),
  };
  return cache;
}
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Commitar: `feat: add msg to TENANT_SCHEMAS and register messaging/payment providers`

---