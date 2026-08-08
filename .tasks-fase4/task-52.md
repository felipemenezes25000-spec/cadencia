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