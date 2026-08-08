import { createHash } from 'node:crypto';
import {
  asRfc3339, asStorageKey, failure, success,
  type ProviderCtx, type Rfc3339,
} from '@cadencia/integrations';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import type { TissSubmissionReceipt, TissTransport } from './types';

export type ModoFakeTiss = 'ok' | 'indisponivel' | 'timeout';

export interface FakeTissArquivoOptions {
  readonly modo?: ModoFakeTiss;
}

export interface SubmittedBatch {
  readonly loteId: string;
  readonly xml: Uint8Array;
  readonly operadoraCnpj: string;
  readonly prestadorCnpj: string;
  readonly prestadorCnes: string;
}

export interface FakeTissArquivoTransport extends TissTransport {
  readonly submittedBatches: readonly SubmittedBatch[];
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeTissArquivoTransport(
  opts: FakeTissArquivoOptions = {},
): FakeTissArquivoTransport {
  const modo = opts.modo ?? 'ok';
  const batches: SubmittedBatch[] = [];

  function talvezFalhar<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({
        kind: 'unavailable', retrySafe: true,
        retryAfterMs: 5000, detail: 'TISS fake indisponivel',
      });
    }
    if (modo === 'timeout') {
      return failure<T>({
        kind: 'timeout', retrySafe: false, detail: 'deadline 3s estourou',
      });
    }
    return null;
  }

  return {
    id: 'tiss-arquivo-fake',
    mode: 'arquivo',
    tissVersion: '4.01.00',
    capabilities: new Set(['residency:br', 'tiss-arquivo']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    get submittedBatches(): readonly SubmittedBatch[] {
      return batches;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const f = talvezFalhar<TissSubmissionReceipt>();
      if (f) return f;

      const iso = isoFromMs(systemClock.nowMs());
      const ano = iso.slice(0, 4);
      const mes = iso.slice(5, 7);
      const seq = batches.length + 1;
      const fileName = `${i.prestador.cnpj}_${ano}_${mes}_${seq}.xml`;
      const sha256 = createHash('sha256').update(i.xml).digest('hex');
      const storageKey = asStorageKey(`tiss-fake/${ctx.tenantId}/${fileName}`);

      batches.push({
        loteId: i.loteId,
        xml: new Uint8Array(i.xml),
        operadoraCnpj: i.operadoraCnpj,
        prestadorCnpj: i.prestador.cnpj,
        prestadorCnes: i.prestador.cnes,
      });

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256,
        instructions:
          `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
          `menu Importar Lote, selecione o arquivo ${fileName}.`,
      };

      return success(receipt, `tiss-fake-${i.loteId}`);
    },

    async fetchDemonstrativo(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'fetchDemonstrativo nao disponivel no fake (Fase 5)',
      });
    },

    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no fake (Fase 5)',
      });
    },
  };
}
