import { failure, type ProviderCtx } from '../contracts/common';
import type { RndsBundleInput, RndsGateway } from '../contracts/rnds';
import type { EsusApsGateway, EsusApsRecordInput } from '../contracts/esus-aps';

export function createUnconfiguredRndsGateway(): RndsGateway {
  return {
    async submitBundle(_input: RndsBundleInput, _ctx: ProviderCtx) {
      return failure({
        kind: 'misconfigured',
        retrySafe: false,
        detail: 'RNDS não configurada neste ambiente',
      });
    },
  };
}

export function createUnconfiguredEsusApsGateway(): EsusApsGateway {
  return {
    async exportRecord(_input: EsusApsRecordInput, _ctx: ProviderCtx) {
      return failure({
        kind: 'misconfigured',
        retrySafe: false,
        detail: 'e-SUS APS não configurado neste ambiente',
      });
    },
  };
}
