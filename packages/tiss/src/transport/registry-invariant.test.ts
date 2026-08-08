import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe a partir da Fase 5 (§7.5)', () => {
  it('o arquivo tiss-soap.ts existe em packages/tiss/src/transport/', () => {
    const soapFile = resolve(import.meta.dirname, 'tiss-soap.ts');
    expect(existsSync(soapFile)).toBe(true);
  });

  it('o registry exporta tiss-arquivo e tiss-soap como transports disponiveis', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
    expect(getTransportFactory('tiss-arquivo')).toBeDefined();
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('nenhum transport fantasma no registry — so tiss-arquivo e tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    for (const id of ids) {
      expect(['tiss-arquivo', 'tiss-soap']).toContain(id);
    }
  });
});
