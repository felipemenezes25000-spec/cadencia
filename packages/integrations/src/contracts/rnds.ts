import type { ProviderCtx, ProviderResult } from './common';

export interface RndsBundleInput {
  readonly patientId: string;
  readonly encounterId: string;
  readonly cnes: string;
  readonly professionalCns: string;
  readonly bundle: Readonly<Record<string, unknown>>;
}

export interface RndsSubmission {
  readonly protocol?: string;
  readonly resourceId?: string;
  readonly receivedAt?: string;
}

/** Fronteira RNDS. Implementação real exige credenciais e contrato do ambiente. */
export interface RndsGateway {
  submitBundle(input: RndsBundleInput, ctx: ProviderCtx): Promise<ProviderResult<RndsSubmission>>;
}
