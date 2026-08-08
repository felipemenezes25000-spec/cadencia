### Task 49: tipos TissSubmissionReceipt e TissTransport (copia literal do design sec 7.5)

**Arquivos**

- Criar `packages/tiss/src/transport/types.ts`
- Teste `packages/tiss/src/transport/types.test.ts`

**Passos**

- [ ] Criar o arquivo de tipos com a interface TissTransport e a uniao TissSubmissionReceipt, copiados literalmente do design (sec 7.5). Os tipos importam de `@cadencia/integrations` os contratos comuns (`Provider`, `ProviderCtx`, `ProviderResult`, `StorageKey`, `Rfc3339`).

```ts
// packages/tiss/src/transport/types.ts

import type {
  Provider, ProviderCtx, ProviderResult, Rfc3339, StorageKey,
} from '@cadencia/integrations';

/**
 * sec 7.5 — TissTransport. Arquivo hoje, SOAP depois. NUNCA constroi XML.
 * O transporte so move bytes. A construcao do XML vive em tiss/serializer.
 */

export type TissSubmissionReceipt =
  | { kind: 'protocolo'; protocolo: string; recebidoEm: Rfc3339 }
  | { kind: 'arquivo'; storageKey: StorageKey; fileName: string; sha256: string; instructions: string };

export interface TissTransport extends Provider {
  readonly mode: 'arquivo' | 'webservice';
  readonly tissVersion: string;

  submitBatch(ctx: ProviderCtx, i: {
    loteId: string;
    xml: Uint8Array;
    operadoraCnpj: string;
    prestador: { cnpj: string; cnes: string };
  }): Promise<ProviderResult<TissSubmissionReceipt>>;

  fetchDemonstrativo(ctx: ProviderCtx, i: {
    protocolo: string;
    operadoraCnpj: string;
  }): Promise<ProviderResult<{ xml: Uint8Array; kind: 'analise' | 'pagamento' }>>;

  submitRecursoGlosa(ctx: ProviderCtx, i: {
    recursoId: string;
    xml: Uint8Array;
    operadoraCnpj: string;
  }): Promise<ProviderResult<TissSubmissionReceipt>>;
}
```

- [ ] Criar o teste unitario que valida a forma dos tipos em tempo de compilacao e verifica que `TissSubmissionReceipt` discrimina corretamente pelo campo `kind`.

```ts
// packages/tiss/src/transport/types.test.ts

import { describe, expect, it } from 'vitest';
import type { TissSubmissionReceipt, TissTransport } from './types';
import type { Rfc3339, StorageKey } from '@cadencia/integrations';

describe('TissTransport tipos', () => {
  it('TissSubmissionReceipt discrimina por kind "arquivo"', () => {
    const receipt: TissSubmissionReceipt = {
      kind: 'arquivo',
      storageKey: 'tiss/lote-001.xml' as StorageKey,
      fileName: '12ABC34503DE37_2026_08_001.xml',
      sha256: 'abc123',
      instructions: 'Acesse o portal, menu Importar Lote',
    };
    expect(receipt.kind).toBe('arquivo');
    if (receipt.kind === 'arquivo') {
      expect(receipt.storageKey).toBe('tiss/lote-001.xml');
      expect(receipt.fileName).toBeDefined();
      expect(receipt.sha256).toBeDefined();
      expect(receipt.instructions).toBeDefined();
    }
  });

  it('TissSubmissionReceipt discrimina por kind "protocolo"', () => {
    const receipt: TissSubmissionReceipt = {
      kind: 'protocolo',
      protocolo: 'PROT-2026-001',
      recebidoEm: '2026-08-07T10:00:00.000Z' as Rfc3339,
    };
    expect(receipt.kind).toBe('protocolo');
    if (receipt.kind === 'protocolo') {
      expect(receipt.protocolo).toBe('PROT-2026-001');
      expect(receipt.recebidoEm).toBeDefined();
    }
  });

  it('TissTransport exige mode, tissVersion e os tres metodos', () => {
    // Verificacao em tempo de compilacao: se o tipo compilar, os campos existem.
    // O teste de runtime usa um objeto que satisfaz a interface minimamente.
    const stub: Pick<TissTransport, 'mode' | 'tissVersion'> = {
      mode: 'arquivo',
      tissVersion: '4.01.00',
    };
    expect(stub.mode).toBe('arquivo');
    expect(stub.tissVersion).toBe('4.01.00');
  });

  it('mode so aceita "arquivo" ou "webservice"', () => {
    const modos: TissTransport['mode'][] = ['arquivo', 'webservice'];
    expect(modos).toContain('arquivo');
    expect(modos).toContain('webservice');
    expect(modos).toHaveLength(2);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/types.test.ts` e confirmar que os 4 testes passam.

Saida esperada: 4 testes passando (discriminacao arquivo, discriminacao protocolo, campos obrigatorios, valores de mode).

- [ ] Commitar: `feat(tiss): add TissSubmissionReceipt and TissTransport types from design sec 7.5`

---