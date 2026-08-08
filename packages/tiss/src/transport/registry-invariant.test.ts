import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap nao existe ate haver credencial real (§7.5)', () => {
  it('o diretorio packages/tiss/src/transport/tiss-soap/ NAO existe no repositorio', () => {
    const soapDir = resolve(import.meta.dirname, 'tiss-soap');
    expect(existsSync(soapDir)).toBe(false);
  });

  it('nenhum arquivo no repositorio exporta uma classe ou funcao chamada TissSoapTransport', async () => {
    const registry = await import('./registry');
    const transportNames = Object.keys(registry);
    expect(transportNames).not.toContain('TissSoapTransport');
    expect(transportNames).not.toContain('tissSoap');
    expect(transportNames).not.toContain('tiss-soap');
  });

  it('o registry exporta SOMENTE tiss-arquivo como transport disponivel', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    expect(getTransportIds()).toEqual(['tiss-arquivo']);
    expect(getTransportFactory('tiss-soap')).toBeUndefined();
    expect(getTransportFactory('tiss-arquivo')).toBeDefined();
  });
});
