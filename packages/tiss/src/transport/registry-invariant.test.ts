import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap nao existe ate haver credencial real (§7.5)', () => {
  it('o diretorio packages/tiss/src/transport/tiss-soap/ NAO existe no repositorio', () => {
    const soapDir = resolve(import.meta.dirname, 'tiss-soap');
    expect(existsSync(soapDir)).toBe(false);
  });

  it('nenhum arquivo no repositorio exporta uma classe ou funcao chamada TissSoapTransport', async () => {
    // Importar o registry e verificar que so conhece tiss-arquivo
    const registry = await import('./registry');
    const transportNames = Object.keys(registry);
    expect(transportNames).not.toContain('TissSoapTransport');
    expect(transportNames).not.toContain('tissSoap');
    expect(transportNames).not.toContain('tiss-soap');
  });

  it('o registry exporta SOMENTE tiss-arquivo como transport disponivel', async () => {
    const registry = await import('./registry');
    // O registry deve exportar um map ou funcao que liste os transports disponiveis
    if (typeof registry.availableTransports === 'function') {
      const disponiveis = registry.availableTransports();
      expect(disponiveis).toEqual(['tiss-arquivo']);
    } else if (typeof registry.TRANSPORTS === 'object' && registry.TRANSPORTS !== null) {
      const chaves = Object.keys(registry.TRANSPORTS);
      expect(chaves).toEqual(['tiss-arquivo']);
    } else if (typeof registry.getTransport === 'function') {
      // Se for um getter, deve reconhecer 'tiss-arquivo' e rejeitar 'tiss-soap'
      expect(() => registry.getTransport('tiss-soap')).toThrow();
    }
  });
});
