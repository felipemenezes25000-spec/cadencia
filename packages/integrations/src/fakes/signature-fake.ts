import { createHmac } from 'node:crypto';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  CertificateInfo, SignDocumentInput, SignatureProvider, SignedDocument, VerifyResult,
} from '../contracts/signature';

/**
 * §7 — TODO contrato tem um fake. É o que permite o produto inteiro se
 * desenvolver offline e o tenant de demonstração existir sem PSC contratado.
 *
 * O fake não imita CAdES: ele produz um HMAC determinístico sobre o hash, o que
 * é suficiente para exercitar idempotência, fila de pendências e o caminho de
 * verificação. Nenhum teste deste repositório afirma conformidade ICP-Brasil a
 * partir do fake — isso é homologação contra o PSC real (Task 42).
 */
const SEGREDO = 'cadencia-fake-signature-do-not-use-in-production';

export type ModoFake = 'ok' | 'indisponivel' | 'timeout' | 'rejeitado';

export interface FakeSignatureOptions {
  readonly modo?: ModoFake;
  readonly agora?: () => Rfc3339;
}

function agoraPadrao(): Rfc3339 {
  return '1970-01-01T00:00:00.000Z' as Rfc3339;
}

function selo(rotulo: string, chave: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', SEGREDO).update(`${rotulo}:${chave}`).digest());
}

export function createFakeSignatureProvider(
  opts: FakeSignatureOptions = {},
): SignatureProvider {
  const modo = opts.modo ?? 'ok';
  const agora = opts.agora ?? agoraPadrao;

  function talvezFalhar<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                       detail: 'PSC fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure({ kind: 'timeout', retrySafe: false, detail: 'deadline de 3s estourou' });
    }
    if (modo === 'rejeitado') {
      return failure({ kind: 'rejected', retrySafe: false, code: 'OTP_INVALIDO',
                       detail: 'segundo fator recusado' });
    }
    return null;
  }

  const certificado: CertificateInfo = {
    subjectCn: 'MEDICO DE TESTE:00000000000',
    signerCpf: '00000000000',
    serial: 'FAKE-0001',
    issuer: 'AC Fake Cadencia',
    notBefore: agora(),
    notAfter: asRfc3339('2046-01-01T00:00:00.000Z') ?? agora(),
  };

  return {
    id: 'signature-fake',
    capabilities: new Set(['residency:br', 'ad-rt', 'ltv']),
    safety: { authorizeSigner: 'idempotent', completeAuthorization: 'unsafe',
              sign: 'idempotent', verify: 'safe', retimestamp: 'idempotent' },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async authorizeSigner(_ctx: ProviderCtx, i) {
      const f = talvezFalhar<{ authorizationUrl: string; state: string }>();
      if (f) return f;
      return success({ authorizationUrl: `https://psc.fake/auth?u=${i.userId}`,
                       state: `state-${i.userId}` }, 'fake-auth');
    },

    async completeAuthorization(_ctx, i) {
      const f = talvezFalhar<{ signerRef: string; certificate: CertificateInfo;
                               expiresAt: Rfc3339 }>();
      if (f) return f;
      return success({ signerRef: `signer-${i.state}`, certificate: certificado,
                       expiresAt: certificado.notAfter }, 'fake-complete');
    },

    async sign(ctx, i) {
      const f = talvezFalhar<readonly SignedDocument[]>();
      if (f) return f;
      const assinados: SignedDocument[] = i.documents.map((d: SignDocumentInput) => ({
        documentId: d.documentId,
        signatureP7s: selo('p7s', `${ctx.idempotencyKey}|${d.hashBase64}`),
        signedAt: agora(),
        timestampToken: selo('tsa', `${ctx.idempotencyKey}|${d.hashBase64}`),
        ltvMaterial: selo('ltv', `${ctx.idempotencyKey}|${d.hashBase64}`),
      }));
      return success(assinados, `fake-sign-${ctx.idempotencyKey}`);
    },

    async verify(i) {
      const f = talvezFalhar<VerifyResult>();
      if (f) return f;
      const hashBase64 = Buffer.from(i.canonicalPayload).toString('base64');
      const esperado = Buffer.from(selo('p7s', `doc-1|${hashBase64}`)).toString('hex');
      const recebido = Buffer.from(i.signatureP7s).toString('hex');
      const bate = esperado === recebido;
      return success<VerifyResult>({
        status: bate ? 'valida' : 'invalida',
        chainOk: bate, revocationOk: bate, timestampOk: bate,
        reasons: bate ? [] : ['hash do payload nao corresponde a assinatura'],
      }, 'fake-verify');
    },

    async retimestamp(ctx, i) {
      const f = talvezFalhar<{ token: Uint8Array }>();
      if (f) return f;
      return success({ token: selo('tsa2', i.signatureId) }, `fake-rets-${ctx.requestId}`);
    },
  };
}
