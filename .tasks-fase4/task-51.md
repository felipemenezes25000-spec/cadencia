### Task 51: TissArquivoTransport — implementacao arquivo com StorageAdapter

**Arquivos**

- Criar `packages/tiss/src/transport/tiss-arquivo.ts`
- Teste `packages/tiss/src/transport/tiss-arquivo.test.ts`

**Passos**

- [ ] Criar o teste unitario PRIMEIRO (TDD). O teste usa InMemoryStorageAdapter e verifica que submitBatch grava o XML, gera nome de arquivo na convencao ANS (CNPJ_ANO_MES_SEQ.xml), computa SHA-256, e retorna receipt com `kind: 'arquivo'`.

```ts
// packages/tiss/src/transport/tiss-arquivo.test.ts

import { describe, expect, it, beforeEach } from 'vitest';
import { createTissArquivoTransport } from './tiss-arquivo';
import { InMemoryStorageAdapter } from '@cadencia/storage';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';
import type { TissSubmissionReceipt } from './types';

const ctx: ProviderCtx = {
  tenantId: 'tenant-001',
  actorUserId: 'user-001',
  requestId: 'req-001',
  idempotencyKey: 'idem-lote-001',
  deadlineMs: 5000,
};

describe('TissArquivoTransport', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('submitBatch grava XML no storage e retorna receipt kind "arquivo"', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>conteudo</loteGuias>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-001',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const receipt = result.value;
    expect(receipt.kind).toBe('arquivo');
    if (receipt.kind !== 'arquivo') return;

    // nome segue convencao ANS: CNPJ_ANO_MES_SEQ.xml
    expect(receipt.fileName).toMatch(/^98XYZ76543AB21_\d{4}_\d{2}_\d+\.xml$/);
    expect(receipt.sha256).toHaveLength(64);
    expect(receipt.instructions).toContain('portal');
    expect(receipt.storageKey).toBeDefined();
  });

  it('submitBatch grava os bytes IDENTICOS ao XML recebido', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>bytes identicos</loteGuias>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-002',
      xml,
      operadoraCnpj: '12ABC34503DE37',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== 'arquivo') return;

    const stored = await storage.get(result.value.storageKey);
    expect(stored).toEqual(xml);
  });

  it('SHA-256 e deterministico: mesmo XML produz mesmo hash', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });

    const xml = new TextEncoder().encode('<loteGuias>determinismo</loteGuias>');
    const r1 = await transport.submitBatch(ctx, {
      loteId: 'lote-a', xml, operadoraCnpj: '11111111111111',
      prestador: { cnpj: '22222222222222', cnes: '1234567' },
    });
    const r2 = await transport.submitBatch(ctx, {
      loteId: 'lote-b', xml, operadoraCnpj: '11111111111111',
      prestador: { cnpj: '22222222222222', cnes: '1234567' },
    });

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    if (r1.value.kind !== 'arquivo' || r2.value.kind !== 'arquivo') return;
    expect(r1.value.sha256).toBe(r2.value.sha256);
  });

  it('mode e "arquivo"', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(transport.mode).toBe('arquivo');
  });

  it('tissVersion reflete o valor passado na criacao', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '3.05.00',
    });
    expect(transport.tissVersion).toBe('3.05.00');
  });

  it('id e "tiss-arquivo"', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(transport.id).toBe('tiss-arquivo');
  });

  it('safety declara todos os tres metodos publicos', () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    expect(assertSafetyDeclared(transport,
      ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'])).toBe(true);
  });

  it('fetchDemonstrativo retorna unsupported (Fase 5)', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const result = await transport.fetchDemonstrativo(ctx, {
      protocolo: 'PROT-001',
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('submitRecursoGlosa retorna unsupported (Fase 5)', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });

  it('health retorna up: true', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const h = await transport.health();
    expect(h.up).toBe(true);
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    expect(h.checkedAt).toBeDefined();
  });

  it('instructions contem o nome do arquivo e a operadora', async () => {
    const transport = createTissArquivoTransport({
      storage,
      tissVersion: '4.01.00',
    });
    const xml = new TextEncoder().encode('<loteGuias/>');
    const result = await transport.submitBatch(ctx, {
      loteId: 'lote-instr',
      xml,
      operadoraCnpj: '55ABC66703DE89',
      prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== 'arquivo') return;

    expect(result.value.instructions).toContain(result.value.fileName);
    expect(result.value.instructions).toContain('55ABC66703DE89');
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/tiss-arquivo.test.ts` e confirmar que TODOS OS TESTES FALHAM porque o modulo ainda nao existe.

Saida esperada: erro de importacao ou 10 testes falhando.

- [ ] Implementar `createTissArquivoTransport`.

```ts
// packages/tiss/src/transport/tiss-arquivo.ts

import { createHash } from 'node:crypto';
import {
  asRfc3339, asStorageKey, failure, success,
  type ProviderCtx, type Rfc3339,
} from '@cadencia/integrations';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import type { StorageAdapter } from '@cadencia/storage';
import type { TissSubmissionReceipt, TissTransport } from './types';

export interface TissArquivoOptions {
  readonly storage: StorageAdapter;
  readonly tissVersion: string;
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

/**
 * Gera nome de arquivo na convencao ANS: CNPJ_ANO_MES_SEQ.xml
 * O SEQ e derivado do loteId para garantir unicidade dentro do mes.
 */
function ansFileName(prestadorCnpj: string, loteId: string): string {
  const now = new Date(systemClock.nowMs());
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, '0');
  // Sequencia derivada do loteId: extrai digitos ou usa hash curto
  const seqHash = createHash('md5').update(loteId).digest('hex').slice(0, 6);
  const seqNum = parseInt(seqHash, 16);
  return `${prestadorCnpj}_${ano}_${mes}_${seqNum}.xml`;
}

export function createTissArquivoTransport(
  opts: TissArquivoOptions,
): TissTransport {
  const { storage, tissVersion } = opts;

  return {
    id: 'tiss-arquivo',
    mode: 'arquivo',
    tissVersion,
    capabilities: new Set(['residency:br', 'tiss-arquivo']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const fileName = ansFileName(i.prestador.cnpj, i.loteId);
      const storageKey = asStorageKey(`tiss/${ctx.tenantId}/${fileName}`);
      const hash = sha256Hex(i.xml);

      await storage.put(storageKey, i.xml, 'application/xml');

      const instructions =
        `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
        `menu Importar Lote, selecione o arquivo ${fileName}.`;

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256: hash,
        instructions,
      };

      return success(receipt, `tiss-arquivo-${i.loteId}`);
    },

    async fetchDemonstrativo(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported',
        retrySafe: false,
        detail: 'fetchDemonstrativo nao disponivel no modo arquivo (Fase 5)',
      });
    },

    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported',
        retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no modo arquivo (Fase 5)',
      });
    },
  };
}
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/tiss-arquivo.test.ts` e confirmar que os 10 testes passam.

Saida esperada: 10 testes passando.

- [ ] Commitar: `feat(tiss): implement TissArquivoTransport with StorageAdapter`

---