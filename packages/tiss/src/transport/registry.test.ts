import { describe, expect, it } from 'vitest';
import { InMemoryStorageAdapter } from '@cadencia/storage';
import {
  getTransportIds,
  getTransportFactory,
  TISS_TRANSPORT_REGISTRY,
} from './registry';

describe('registry de transports TISS', () => {
  it('registry conhece tiss-arquivo e tiss-soap', () => {
    const ids = getTransportIds();
    expect(ids).toEqual(['tiss-arquivo', 'tiss-soap']);
  });

  it('getTransportFactory retorna a factory de tiss-arquivo', () => {
    const factory = getTransportFactory('tiss-arquivo');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna a factory de tiss-soap', () => {
    const factory = getTransportFactory('tiss-soap');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna undefined para id desconhecido', () => {
    expect(getTransportFactory('tiss-inexistente')).toBeUndefined();
  });

  it('TISS_TRANSPORT_REGISTRY e congelado (nao pode ser modificado em runtime)', () => {
    expect(Object.isFrozen(TISS_TRANSPORT_REGISTRY)).toBe(true);
  });

  it('factory de tiss-arquivo cria transport com mode "arquivo"', () => {
    const factory = getTransportFactory('tiss-arquivo')! as (opts: import('./tiss-arquivo').TissArquivoOptions) => import('./types').TissTransport;
    const transport = factory({
      // Import no topo, e nao `require` aqui dentro: o require so funcionava
      // enquanto o barril de @cadencia/storage nao tinha import relativo em
      // runtime. Bastou o pacote ganhar um adaptador para a interop CJS parar
      // de resolver — e o erro apontava para o pacote, nao para o teste.
      storage: new InMemoryStorageAdapter(),
      tissVersion: '4.01.00',
    });
    expect(transport.id).toBe('tiss-arquivo');
    expect(transport.mode).toBe('arquivo');
    expect(transport.tissVersion).toBe('4.01.00');
  });

  it('factory de tiss-soap retorna SoapNotConfigured sem credenciais', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: '',
      soapUsername: '',
      soapPassword: '',
    }) as { ok: boolean; error?: { kind: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('soap_not_configured');
  });

  it('factory de tiss-soap retorna Ok com credenciais validas', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
      soapUsername: 'user',
      soapPassword: 'pass',
    }) as { ok: boolean; value?: { id: string; mode: string } };
    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe('tiss-soap');
    expect(result.value?.mode).toBe('webservice');
  });
});
