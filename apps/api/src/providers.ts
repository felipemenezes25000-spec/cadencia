import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  type PrescriptionProvider, type SignatureProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
  };
  return cache;
}
