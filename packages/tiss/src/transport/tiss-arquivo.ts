import { createHash } from 'node:crypto';
import {
  asRfc3339, asStorageKey, failure, success,
  type ProviderCtx, type Rfc3339,
} from '@cadencia/integrations';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import type { StorageAdapter } from '@cadencia/storage';
import type { TissSubmissionReceipt, TissTransport } from './types';

export interface TissArquivoOptions {
  readonly storage: StorageAdapter;
  readonly tissVersion: string;
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

/**
 * Gera nome de arquivo na convenção ANS: CNPJ_ANO_MES_SEQ.xml
 * O SEQ é derivado do loteId para garantir unicidade dentro do mês.
 */
function ansFileName(prestadorCnpj: string, loteId: string): string {
  const iso = isoFromMs(systemClock.nowMs());
  const ano = iso.slice(0, 4);
  const mes = iso.slice(5, 7);
  // Sequência derivada do loteId: extrai dígitos ou usa hash curto
  const seqHash = createHash('md5').update(loteId).digest('hex').slice(0, 6);
  const seqNum = parseInt(seqHash, 16);
  return `${prestadorCnpj}_${ano}_${mes}_${seqNum}.xml`;
}

export function createTissArquivoTransport(
  opts: TissArquivoOptions,
): TissTransport {
  const { storage, tissVersion } = opts;

  return {
    id: 'tiss-arquivo',
    mode: 'arquivo',
    tissVersion,
    capabilities: new Set(['residency:br', 'tiss-arquivo']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const fileName = ansFileName(i.prestador.cnpj, i.loteId);
      const storageKey = asStorageKey(`tiss/${ctx.tenantId}/${fileName}`);
      const hash = sha256Hex(i.xml);

      await storage.put(storageKey, i.xml, 'application/xml');

      const instructions =
        `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
        `menu Importar Lote, selecione o arquivo ${fileName}.`;

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256: hash,
        instructions,
      };

      return success(receipt, `tiss-arquivo-${i.loteId}`);
    },

    async fetchDemonstrativo(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported',
        retrySafe: false,
        detail: 'fetchDemonstrativo nao disponivel no modo arquivo (Fase 5)',
      });
    },

    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported',
        retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no modo arquivo (Fase 5)',
      });
    },
  };
}
