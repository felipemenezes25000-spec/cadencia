import type { TissTransport } from './types';
import { createTissArquivoTransport, type TissArquivoOptions } from './tiss-arquivo';
import {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './tiss-soap';
import type { Result } from '@cadencia/kernel';

/**
 * Registry de transports TISS. Congelado em runtime.
 *
 * tiss-arquivo: sempre disponivel — gera arquivo para upload manual no portal.
 * tiss-soap: disponivel quando a operadora tem soap_endpoint configurado no
 *   contrato. A factory retorna Result — se credenciais ausentes, o caller
 *   recebe SoapNotConfigured em vez de exception.
 */

type ArquivoFactory = (opts: TissArquivoOptions) => TissTransport;
type SoapFactory = (opts: TissSoapOptions) => Result<TissTransport, SoapNotConfigured>;

export type TransportFactory = ArquivoFactory | SoapFactory;

export const TISS_TRANSPORT_REGISTRY: Readonly<Record<string, TransportFactory>> =
  Object.freeze({
    'tiss-arquivo': createTissArquivoTransport,
    'tiss-soap': createTissSoapTransport,
  });

export function getTransportIds(): string[] {
  return Object.keys(TISS_TRANSPORT_REGISTRY);
}

export function getTransportFactory(id: string): TransportFactory | undefined {
  return TISS_TRANSPORT_REGISTRY[id];
}
