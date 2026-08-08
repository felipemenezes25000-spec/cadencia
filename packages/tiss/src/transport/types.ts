import type {
  Provider, ProviderCtx, ProviderResult, Rfc3339, StorageKey,
} from '@cadencia/integrations';

/**
 * sec 7.5 — TissTransport. Arquivo hoje, SOAP depois. NUNCA constroi XML.
 * O transporte so move bytes. A construcao do XML vive em tiss/serializer.
 */

export type TissSubmissionReceipt =
  | { kind: 'protocolo'; protocolo: string; recebidoEm: Rfc3339 }
  | { kind: 'arquivo'; storageKey: StorageKey; fileName: string; sha256: string; instructions: string };

export interface TissTransport extends Provider {
  readonly mode: 'arquivo' | 'webservice';
  readonly tissVersion: string;

  submitBatch(ctx: ProviderCtx, i: {
    loteId: string;
    xml: Uint8Array;
    operadoraCnpj: string;
    prestador: { cnpj: string; cnes: string };
  }): Promise<ProviderResult<TissSubmissionReceipt>>;

  fetchDemonstrativo(ctx: ProviderCtx, i: {
    protocolo: string;
    operadoraCnpj: string;
  }): Promise<ProviderResult<{ xml: Uint8Array; kind: 'analise' | 'pagamento' }>>;

  submitRecursoGlosa(ctx: ProviderCtx, i: {
    recursoId: string;
    xml: Uint8Array;
    operadoraCnpj: string;
  }): Promise<ProviderResult<TissSubmissionReceipt>>;
}
