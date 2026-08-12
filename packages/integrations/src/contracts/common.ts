/**
 * §7 — o contrato comum de todo provedor externo.
 *
 * A garantia mais cara do documento: timeout NUNCA gera retry automático em
 * operação `unsafe`. Gera estado `indeterminado` persistido e agenda
 * RECONCILIAÇÃO — o job consulta o parceiro (getPayment, fetchPrescription,
 * busca por idempotencyKey) e só reenvia se confirmar que não houve efeito.
 * Sem isso: três WhatsApps idênticos às 7h da manhã degradando a qualidade do
 * número PRÓPRIO da clínica, estorno em dobro, lote TISS glosado por duplicidade.
 */

export type Rfc3339 = string & { readonly __brand: 'Rfc3339' };   // UTC, com ms
export type E164 = string & { readonly __brand: 'E164' };
export type StorageKey = string & { readonly __brand: 'StorageKey' };

/** Retryability é propriedade da OPERAÇÃO, não do erro. */
export type Safety = 'safe' | 'idempotent' | 'unsafe';

export interface ProviderCtx {
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly requestId: string;
  /** Estável por agregado + intenção. Duas chamadas da mesma intenção repetem a chave. */
  readonly idempotencyKey: string;
  readonly deadlineMs: number;
}

export type ProviderFailure =
  | { kind: 'unavailable';   retrySafe: true;  retryAfterMs?: number; detail: string }
  | { kind: 'timeout';       retrySafe: false; detail: string }   // ESTADO DESCONHECIDO
  | { kind: 'rejected';      retrySafe: false; code: string; detail: string }
  | { kind: 'misconfigured'; retrySafe: false; detail: string }
  | { kind: 'unsupported';   retrySafe: false; detail: string };

export type ProviderResult<T> =
  | { ok: true;  value: T; providerRef: string; rawArchiveKey?: StorageKey }
  | { ok: false; error: ProviderFailure; rawArchiveKey?: StorageKey };

export interface Provider {
  readonly id: string;
  /** Inclui 'residency:br' quando aplicável. O runtime recusa quem não declara. */
  readonly capabilities: ReadonlySet<string>;
  /** Por método, OBRIGATÓRIO: é o que o reconciliador consulta. */
  readonly safety: Readonly<Record<string, Safety>>;
  health(): Promise<{ up: boolean; latencyMs: number; checkedAt: Rfc3339 }>;
}

export function success<T>(value: T, providerRef: string, rawArchiveKey?: StorageKey):
ProviderResult<T> {
  return rawArchiveKey === undefined
    ? { ok: true, value, providerRef }
    : { ok: true, value, providerRef, rawArchiveKey };
}

export function failure<T>(error: ProviderFailure, rawArchiveKey?: StorageKey):
ProviderResult<T> {
  return rawArchiveKey === undefined ? { ok: false, error } : { ok: false, error, rawArchiveKey };
}

/** Única porta de entrada do retry automático. Não existe outra regra em lugar nenhum. */
export function isRetryable<T>(r: ProviderResult<T>): boolean {
  return !r.ok && r.error.kind === 'unavailable';
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
export function asE164(v: string): E164 | null {
  return E164_RE.test(v) ? (v as E164) : null;
}

const RFC3339_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function asRfc3339(v: string): Rfc3339 | null {
  return RFC3339_MS_RE.test(v) ? (v as Rfc3339) : null;
}

export function asStorageKey(v: string): StorageKey {
  return v as StorageKey;
}
