import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type { TissTransportProvider } from '../contracts/tiss-transport';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeTissTransportProvider(): TissTransportProvider {
  return {
    id: 'tiss-transport-fake',
    capabilities: new Set(['residency:br', 'tiss_4.01']),
    safety: {
      enviarLote: 'idempotent',
      consultarProtocolo: 'safe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async enviarLote(_ctx: ProviderCtx, _i) {
      const protocolo = crypto.randomUUID();
      return success({
        protocolo,
        dataRecebimento: agora(),
        hashLote: protocolo,
      }, protocolo);
    },

    async consultarProtocolo(_ctx: ProviderCtx, _i) {
      return success({
        status: 'aceito' as const,
        guiasAceitas: 1,
        guiasRejeitadas: 0,
        erros: [],
      }, _i.protocolo);
    },
  };
}
