import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe com credencial real (Fase 5)', () => {
  it('o arquivo tiss-soap.ts existe em packages/tiss/src/transport/', () => {
    const soapFile = resolve(import.meta.dirname, 'tiss-soap.ts');
    expect(existsSync(soapFile)).toBe(true);
  });

  it('o registry exporta tiss-soap como transport disponivel', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    expect(getTransportIds()).toContain('tiss-soap');
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('o registry exporta tiss-arquivo E tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
  });
});
