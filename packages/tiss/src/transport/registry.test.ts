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
