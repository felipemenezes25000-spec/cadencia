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
