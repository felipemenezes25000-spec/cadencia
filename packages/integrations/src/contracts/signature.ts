import type { Provider, ProviderCtx, ProviderResult, Rfc3339, StorageKey } from './common';

/**
 * §7.2 e §10 item 7 — PSC em nuvem. A chave privada do médico NUNCA sai do HSM:
 * enviamos o HASH e recebemos o PKCS#7 destacado. Isso remove um passivo enorme
 * (guardar chave privada de terceiro) e é a razão de o contrato falar em hash.
 *
 * AD_RB NÃO EXISTE neste tipo, de propósito. Com guarda de 20 anos, assinatura
 * sem carimbo de tempo vira "indeterminada" quando o certificado expira e a AC
 * para de publicar a LCR daquela data — e isso acontece com o acervo INTEIRO de
 * uma vez, sem correção retroativa.
 */
export const SIGNATURE_POLICIES = ['AD_RT_CAdES_2.4', 'AD_RA_CAdES_2.4'] as const;
export type SignaturePolicy = (typeof SIGNATURE_POLICIES)[number];

export function isSignaturePolicy(v: string): v is SignaturePolicy {
  return (SIGNATURE_POLICIES as readonly string[]).includes(v);
}

export interface CertificateInfo {
  readonly subjectCn: string;
  readonly signerCpf: string;
  readonly serial: string;
  readonly issuer: string;
  readonly notBefore: Rfc3339;
  readonly notAfter: Rfc3339;
}

export interface SignDocumentInput {
  readonly documentId: string;
  readonly hashAlgorithm: 'SHA-256';
  readonly hashBase64: string;
  /** Os BYTES canônicos que geraram o hash, no S3. Sem eles não se verifica nada. */
  readonly canonicalPayloadKey: StorageKey;
  readonly canonicalVersion: string;
  readonly policy: SignaturePolicy;
  readonly detached: true;
}

export interface SignedDocument {
  readonly documentId: string;
  readonly signatureP7s: Uint8Array;
  readonly signedAt: Rfc3339;
  /** ACT credenciada: OBRIGATÓRIO, não opcional. */
  readonly timestampToken: Uint8Array;
  /** Cadeia + LCR/OCSP do instante da assinatura. É o que faz o LTV existir. */
  readonly ltvMaterial: Uint8Array;
}

export interface VerifyResult {
  readonly status: 'valida' | 'invalida' | 'indeterminada';
  readonly chainOk: boolean;
  readonly revocationOk: boolean;
  readonly timestampOk: boolean;
  readonly reasons: readonly string[];
}

export interface SignatureProvider extends Provider {
  authorizeSigner(ctx: ProviderCtx, i: { userId: string; redirectUri: string }):
    Promise<ProviderResult<{ authorizationUrl: string; state: string }>>;

  completeAuthorization(ctx: ProviderCtx, i: { state: string; code: string }):
    Promise<ProviderResult<{ signerRef: string; certificate: CertificateInfo; expiresAt: Rfc3339 }>>;

  /** Assina o HASH do payload canônico. safety: 'idempotent' por documentId. */
  sign(ctx: ProviderCtx, i: { signerRef: string; otp?: string;
    documents: readonly SignDocumentInput[] }):
    Promise<ProviderResult<readonly SignedDocument[]>>;

  verify(i: { canonicalPayload: Uint8Array; signatureP7s: Uint8Array; at?: Rfc3339 }):
    Promise<ProviderResult<VerifyResult>>;

  retimestamp(ctx: ProviderCtx, i: { signatureId: string }):
    Promise<ProviderResult<{ token: Uint8Array }>>;
}
