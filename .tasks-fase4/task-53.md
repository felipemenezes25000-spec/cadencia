### Task 53: fake transport para testes de integracao e re-export pelo index

**Arquivos**

- Criar `packages/tiss/src/transport/tiss-arquivo-fake.ts`
- Teste `packages/tiss/src/transport/tiss-arquivo-fake.test.ts`
- Modificar `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar o teste PRIMEIRO para o fake transport. O fake simula os tres modos (ok, indisponivel, timeout) e armazena os lotes submetidos para inspecao.

```ts
// packages/tiss/src/transport/tiss-arquivo-fake.test.ts

import { describe, expect, it, beforeEach } from 'vitest';
import { createFakeTissArquivoTransport, type FakeTissArquivoOptions } from './tiss-arquivo-fake';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-fake',
  actorUserId: 'user-fake',
  requestId: 'req-fake',
  idempotencyKey: 'idem-fake-001',
  deadlineMs: 3000,
};

describe('FakeTissArquivoTransport', () => {
  it('modo ok: submitBatch retorna receipt com kind "arquivo"', async () => {
    const transport = createFakeTissArquivoTransport();
    const xml = new TextEncoder().encode('<loteGuias>fake</loteGuias>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-fake-001',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('arquivo');
    if (result.value.kind !== 'arquivo') return;
    expect(result.value.fileName).toContain('98XYZ76543AB21');
    expect(result.value.sha256).toHaveLength(64);
    expect(result.value.instructions).toContain('portal');
  });

  it('modo ok: lotes submetidos ficam disponiveis para inspecao', async () => {
    const transport = createFakeTissArquivoTransport();
    const xml = new TextEncoder().encode('<loteGuias>inspecao</loteGuias>');

    await transport.submitBatch(ctx, {
      loteId: 'lote-insp',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(transport.submittedBatches).toHaveLength(1);
    expect(transport.submittedBatches[0]!.loteId).toBe('lote-insp');
    expect(transport.submittedBatches[0]!.xml).toEqual(xml);
  });

  it('modo indisponivel: submitBatch retorna unavailable', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'indisponivel' });
    const xml = new TextEncoder().encode('<loteGuias/>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-err',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unavailable');
  });

  it('modo timeout: submitBatch retorna timeout', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });
    const xml = new TextEncoder().encode('<loteGuias/>');

    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-to',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
  });

  it('mode e "arquivo" e id e "tiss-arquivo-fake"', () => {
    const transport = createFakeTissArquivoTransport();
    expect(transport.mode).toBe('arquivo');
    expect(transport.id).toBe('tiss-arquivo-fake');
  });

  it('safety declara todos os tres metodos', () => {
    const transport = createFakeTissArquivoTransport();
    expect(assertSafetyDeclared(transport,
      ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'])).toBe(true);
  });

  it('fetchDemonstrativo retorna unsupported', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.fetchDemonstrativo(ctx, {
      protocolo: 'PROT-001',
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('submitRecursoGlosa retorna unsupported', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('health retorna up: true em modo ok e up: false em modo indisponivel', async () => {
    const ok = createFakeTissArquivoTransport();
    expect((await ok.health()).up).toBe(true);

    const down = createFakeTissArquivoTransport({ modo: 'indisponivel' });
    expect((await down.health()).up).toBe(false);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/tiss-arquivo-fake.test.ts` e confirmar que falha porque o modulo nao existe.

Saida esperada: erro de importacao.

- [ ] Implementar o fake transport.

```ts
// packages/tiss/src/transport/tiss-arquivo-fake.ts

import { createHash } from 'node:crypto';
import {
  asRfc3339, asStorageKey, failure, success,
  type ProviderCtx, type Rfc3339,
} from '@cadencia/integrations';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import type { TissSubmissionReceipt, TissTransport } from './types';

export type ModoFakeTiss = 'ok' | 'indisponivel' | 'timeout';

export interface FakeTissArquivoOptions {
  readonly modo?: ModoFakeTiss;
}

export interface SubmittedBatch {
  readonly loteId: string;
  readonly xml: Uint8Array;
  readonly operadoraCnpj: string;
  readonly prestadorCnpj: string;
  readonly prestadorCnes: string;
}

export interface FakeTissArquivoTransport extends TissTransport {
  readonly submittedBatches: readonly SubmittedBatch[];
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeTissArquivoTransport(
  opts: FakeTissArquivoOptions = {},
): FakeTissArquivoTransport {
  const modo = opts.modo ?? 'ok';
  const batches: SubmittedBatch[] = [];

  function talvezFalhar<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({
        kind: 'unavailable', retrySafe: true,
        retryAfterMs: 5000, detail: 'TISS fake indisponivel',
      });
    }
    if (modo === 'timeout') {
      return failure<T>({
        kind: 'timeout', retrySafe: false, detail: 'deadline 3s estourou',
      });
    }
    return null;
  }

  return {
    id: 'tiss-arquivo-fake',
    mode: 'arquivo',
    tissVersion: '4.01.00',
    capabilities: new Set(['residency:br', 'tiss-arquivo']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    get submittedBatches(): readonly SubmittedBatch[] {
      return batches;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const f = talvezFalhar<TissSubmissionReceipt>();
      if (f) return f;

      const now = new Date(systemClock.nowMs());
      const ano = now.getUTCFullYear();
      const mes = String(now.getUTCMonth() + 1).padStart(2, '0');
      const seq = batches.length + 1;
      const fileName = `${i.prestador.cnpj}_${ano}_${mes}_${seq}.xml`;
      const sha256 = createHash('sha256').update(i.xml).digest('hex');
      const storageKey = asStorageKey(`tiss-fake/${ctx.tenantId}/${fileName}`);

      batches.push({
        loteId: i.loteId,
        xml: new Uint8Array(i.xml),
        operadoraCnpj: i.operadoraCnpj,
        prestadorCnpj: i.prestador.cnpj,
        prestadorCnes: i.prestador.cnes,
      });

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256,
        instructions:
          `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
          `menu Importar Lote, selecione o arquivo ${fileName}.`,
      };

      return success(receipt, `tiss-fake-${i.loteId}`);
    },

    async fetchDemonstrativo(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'fetchDemonstrativo nao disponivel no fake (Fase 5)',
      });
    },

    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no fake (Fase 5)',
      });
    },
  };
}
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/tiss-arquivo-fake.test.ts` e confirmar que os 9 testes passam.

Saida esperada: 9 testes passando.

- [ ] Atualizar `packages/tiss/src/index.ts` para re-exportar os contratos publicos do transport.

```ts
// packages/tiss/src/index.ts

export type { TissSubmissionReceipt, TissTransport } from './transport/types';
export { createTissArquivoTransport, type TissArquivoOptions } from './transport/tiss-arquivo';
export {
  getTransportIds, getTransportFactory, TISS_TRANSPORT_REGISTRY,
} from './transport/registry';
export {
  createFakeTissArquivoTransport,
  type FakeTissArquivoOptions,
  type FakeTissArquivoTransport,
  type ModoFakeTiss,
  type SubmittedBatch,
} from './transport/tiss-arquivo-fake';
```

- [ ] Rodar todos os testes do pacote tiss de uma vez para confirmar que tudo esta coeso: `pnpm vitest run packages/tiss/src/`.

Saida esperada: 25 testes passando (4 de types + 10 de tiss-arquivo + 6 de registry + 9 de fake - ajustes conforme contagem real, todos verdes).

- [ ] Commitar: `feat(tiss): add fake transport for integration tests and re-export from index`