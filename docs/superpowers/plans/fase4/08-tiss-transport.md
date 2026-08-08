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

### Task 50: StorageAdapter — interface abstrata de armazenamento de arquivos

**Arquivos**

- Modificar `packages/storage/src/index.ts`
- Teste `packages/storage/src/storage-adapter.test.ts`

**Passos**

- [ ] Definir a interface `StorageAdapter` em `packages/storage/src/index.ts`. Ela abstrai o armazenamento de arquivos (fs local para dev, S3 para producao). A interface e minima: `put`, `get`, `exists` e `delete`.

```ts
// packages/storage/src/index.ts

/**
 * L0 — Adaptador abstrato de armazenamento de objetos.
 * Implementacao local (fs) para dev; S3-compatible para producao.
 * Chaves sao opacos UUIDv7 com prefixo de namespace (ex: "tiss/lote-001.xml").
 */
export interface StorageAdapter {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * InMemoryStorageAdapter — para testes unitarios e de integracao.
 * NAO usar em producao. Nao persiste entre reinicializacoes.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.store.set(key, { data: new Uint8Array(data), contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const entry = this.store.get(key);
    return entry !== undefined ? new Uint8Array(entry.data) : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Utilitario de teste: retorna todas as chaves armazenadas. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Utilitario de teste: limpa todo o armazenamento. */
  clear(): void {
    this.store.clear();
  }
}
```

- [ ] Criar o teste unitario que verifica o ciclo completo do InMemoryStorageAdapter.

```ts
// packages/storage/src/storage-adapter.test.ts

import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from './index';

describe('InMemoryStorageAdapter', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('put e get devolvem os mesmos bytes', async () => {
    const dados = new TextEncoder().encode('conteudo do lote TISS');
    await storage.put('tiss/lote-001.xml', dados, 'application/xml');

    const resultado = await storage.get('tiss/lote-001.xml');
    expect(resultado).not.toBeNull();
    expect(resultado).toEqual(dados);
  });

  it('get retorna null para chave inexistente', async () => {
    const resultado = await storage.get('nao-existe');
    expect(resultado).toBeNull();
  });

  it('exists retorna true para chave existente e false para inexistente', async () => {
    const dados = new Uint8Array([1, 2, 3]);
    await storage.put('chave-a', dados, 'application/octet-stream');

    expect(await storage.exists('chave-a')).toBe(true);
    expect(await storage.exists('chave-b')).toBe(false);
  });

  it('delete remove o objeto armazenado', async () => {
    const dados = new Uint8Array([10, 20]);
    await storage.put('temp', dados, 'text/plain');
    expect(await storage.exists('temp')).toBe(true);

    await storage.delete('temp');
    expect(await storage.exists('temp')).toBe(false);
    expect(await storage.get('temp')).toBeNull();
  });

  it('put sobrescreve dados existentes na mesma chave', async () => {
    const v1 = new TextEncoder().encode('versao 1');
    const v2 = new TextEncoder().encode('versao 2');
    await storage.put('doc', v1, 'text/plain');
    await storage.put('doc', v2, 'text/plain');

    const resultado = await storage.get('doc');
    expect(resultado).toEqual(v2);
  });

  it('put faz copia defensiva dos bytes', async () => {
    const original = new Uint8Array([1, 2, 3]);
    await storage.put('copia', original, 'application/octet-stream');
    original[0] = 99;

    const resultado = await storage.get('copia');
    expect(resultado![0]).toBe(1);
  });

  it('get faz copia defensiva dos bytes retornados', async () => {
    const dados = new Uint8Array([5, 6, 7]);
    await storage.put('safe', dados, 'application/octet-stream');

    const r1 = await storage.get('safe');
    r1![0] = 99;

    const r2 = await storage.get('safe');
    expect(r2![0]).toBe(5);
  });

  it('keys() lista todas as chaves armazenadas', async () => {
    await storage.put('a', new Uint8Array([1]), 'text/plain');
    await storage.put('b', new Uint8Array([2]), 'text/plain');

    expect(storage.keys().sort()).toEqual(['a', 'b']);
  });

  it('clear() esvazia o armazenamento', async () => {
    await storage.put('x', new Uint8Array([1]), 'text/plain');
    storage.clear();

    expect(storage.keys()).toEqual([]);
    expect(await storage.exists('x')).toBe(false);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/storage/src/storage-adapter.test.ts` e confirmar que os 9 testes passam.

Saida esperada: 9 testes passando.

- [ ] Commitar: `feat(storage): add StorageAdapter interface and InMemoryStorageAdapter`

---

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

### Task 52: registry de transports — so tiss-arquivo, nunca tiss-soap

**Arquivos**

- Criar `packages/tiss/src/transport/registry.ts`
- Teste `packages/tiss/src/transport/registry.test.ts`

**Passos**

- [ ] Criar o teste PRIMEIRO. O teste mais importante e o de CI: o registry NAO exporta nem registra `tiss-soap`. Sem diretorio `tiss-soap/` no repositorio, sem registro no mapa.

```ts
// packages/tiss/src/transport/registry.test.ts

import { describe, expect, it } from 'vitest';
import {
  getTransportIds,
  getTransportFactory,
  TISS_TRANSPORT_REGISTRY,
} from './registry';

describe('registry de transports TISS', () => {
  it('registry so conhece tiss-arquivo', () => {
    const ids = getTransportIds();
    expect(ids).toEqual(['tiss-arquivo']);
  });

  it('registry NAO exporta nem registra tiss-soap', () => {
    const ids = getTransportIds();
    expect(ids).not.toContain('tiss-soap');
    expect(getTransportFactory('tiss-soap')).toBeUndefined();
  });

  it('getTransportFactory retorna a factory de tiss-arquivo', () => {
    const factory = getTransportFactory('tiss-arquivo');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna undefined para id desconhecido', () => {
    expect(getTransportFactory('tiss-inexistente')).toBeUndefined();
  });

  it('TISS_TRANSPORT_REGISTRY e congelado (nao pode ser modificado em runtime)', () => {
    expect(Object.isFrozen(TISS_TRANSPORT_REGISTRY)).toBe(true);
  });

  it('a factory cria um transport funcional com mode "arquivo"', () => {
    const factory = getTransportFactory('tiss-arquivo')!;
    const { InMemoryStorageAdapter } = require('@cadencia/storage');
    const transport = factory({
      storage: new InMemoryStorageAdapter(),
      tissVersion: '4.01.00',
    });
    expect(transport.id).toBe('tiss-arquivo');
    expect(transport.mode).toBe('arquivo');
    expect(transport.tissVersion).toBe('4.01.00');
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/registry.test.ts` e confirmar que falha porque o modulo nao existe.

Saida esperada: erro de importacao.

- [ ] Implementar o registry.

```ts
// packages/tiss/src/transport/registry.ts

import type { TissTransport } from './types';
import { createTissArquivoTransport, type TissArquivoOptions } from './tiss-arquivo';

/**
 * Registry de transports TISS. Congelado em runtime.
 *
 * tiss-soap NAO existe ate haver credencial real de cliente (Fase 5).
 * Um teste de CI garante que este registry so conhece tiss-arquivo.
 */

type TransportFactory = (opts: TissArquivoOptions) => TissTransport;

export const TISS_TRANSPORT_REGISTRY: Readonly<Record<string, TransportFactory>> =
  Object.freeze({
    'tiss-arquivo': createTissArquivoTransport,
  });

export function getTransportIds(): string[] {
  return Object.keys(TISS_TRANSPORT_REGISTRY);
}

export function getTransportFactory(id: string): TransportFactory | undefined {
  return TISS_TRANSPORT_REGISTRY[id];
}
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/registry.test.ts` e confirmar que os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(tiss): add transport registry — only tiss-arquivo, never tiss-soap`

---

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
