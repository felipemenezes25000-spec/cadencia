import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  CertificateInfo, SignatureProvider, SignedDocument, VerifyResult,
} from '../contracts/signature';

export interface BirdIdConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl?: string;
}

const PROD_URL = 'https://api.birdid.com.br';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

async function birdRequest<T>(
  url: string, ctx: ProviderCtx,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ProviderResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'cadencia/1.0',
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
        detail: 'rate limit' });
    }
    if (res.status >= 500) {
      return failure({ kind: 'unavailable', retrySafe: true, detail: `birdid ${res.status}` });
    }
    const json = await res.json() as T;
    if (!res.ok) {
      const detail = (json as { error_description?: string }).error_description
        ?? `status ${res.status}`;
      return failure({ kind: 'rejected', retrySafe: false,
        code: `BIRDID_${res.status}`, detail });
    }
    return success(json, '');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return failure({ kind: 'timeout', retrySafe: false, detail: `deadline ${ctx.deadlineMs}ms` });
    }
    return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
  } finally {
    clearTimeout(timer);
  }
}

export function createBirdIdSignatureProvider(cfg: BirdIdConfig): SignatureProvider {
  const base = cfg.baseUrl ?? PROD_URL;

  return {
    id: 'signature-birdid',
    capabilities: new Set(['residency:br', 'icp_brasil', 'cades']),
    safety: {
      authorizeSigner: 'safe',
      completeAuthorization: 'idempotent',
      sign: 'idempotent',
      verify: 'safe',
      retimestamp: 'idempotent',
    },

    async health() {
      const t0 = systemClock.nowMs();
      let up = false;
      try {
        const res = await fetch(`${base}/.well-known/openid-configuration`, {
          signal: AbortSignal.timeout(5000),
        });
        up = res.ok;
      } catch { /* offline */ }
      return { up, latencyMs: systemClock.nowMs() - t0, checkedAt: agora() };
    },

    async authorizeSigner(_ctx, i) {
      const state = crypto.randomUUID();
      const authorizationUrl =
        `${base}/oauth/authorize?` +
        `client_id=${encodeURIComponent(cfg.clientId)}` +
        `&redirect_uri=${encodeURIComponent(i.redirectUri)}` +
        `&response_type=code` +
        `&scope=sign` +
        `&state=${state}` +
        `&login_hint=${encodeURIComponent(i.userId)}`;
      return success({ authorizationUrl, state }, state);
    },

    async completeAuthorization(ctx, i) {
      const tokenR = await birdRequest<{
        access_token: string; certificate_alias: string;
        certificate: {
          subject_cn: string; cpf: string; serial_number: string;
          issuer_cn: string; not_before: string; not_after: string;
        };
        expires_in: number;
      }>(`${base}/oauth/token`, ctx, {
        method: 'POST',
        body: {
          grant_type: 'authorization_code',
          code: i.code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        },
      });
      if (!tokenR.ok) return tokenR;

      const cert = tokenR.value.certificate;
      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + tokenR.value.expires_in * 1000),
      ) ?? agora();

      const certificate: CertificateInfo = {
        subjectCn: cert.subject_cn,
        signerCpf: cert.cpf,
        serial: cert.serial_number,
        issuer: cert.issuer_cn,
        notBefore: (asRfc3339(cert.not_before) ?? agora()),
        notAfter: (asRfc3339(cert.not_after) ?? agora()),
      };

      return success({
        signerRef: `${tokenR.value.access_token}::${tokenR.value.certificate_alias}`,
        certificate,
        expiresAt,
      }, tokenR.value.certificate_alias);
    },

    async sign(ctx, i) {
      const [accessToken, alias] = i.signerRef.split('::');

      const hashes = i.documents.map((d) => ({
        hash: d.hashBase64,
        hash_algorithm: d.hashAlgorithm,
        document_id: d.documentId,
      }));

      const signR = await birdRequest<{
        signatures: Array<{
          document_id: string;
          pkcs7: string;
          signed_at: string;
          tst: string;
          ltv: string;
        }>;
      }>(`${base}/v2/sign`, ctx, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: {
          certificate_alias: alias,
          hashes,
          ...(i.otp !== undefined ? { otp: i.otp } : {}),
        },
      });
      if (!signR.ok) return signR;

      const docs: SignedDocument[] = signR.value.signatures.map((s) => ({
        documentId: s.document_id,
        signatureP7s: Uint8Array.from(atob(s.pkcs7), (c) => c.charCodeAt(0)),
        signedAt: (asRfc3339(s.signed_at) ?? agora()),
        timestampToken: Uint8Array.from(atob(s.tst), (c) => c.charCodeAt(0)),
        ltvMaterial: Uint8Array.from(atob(s.ltv), (c) => c.charCodeAt(0)),
      }));

      return success(docs, 'batch-sign');
    },

    async verify(_i) {
      return success<VerifyResult>({
        status: 'indeterminada',
        chainOk: false,
        revocationOk: false,
        timestampOk: false,
        reasons: ['verificacao local nao implementada — use o ITI Verificador'],
      }, 'verify');
    },

    async retimestamp(ctx, i) {
      const r = await birdRequest<{ tst: string }>(
        `${base}/v2/retimestamp`, ctx,
        { method: 'POST', body: { signature_id: i.signatureId } },
      );
      if (!r.ok) return r;
      return success({
        token: Uint8Array.from(atob(r.value.tst), (c) => c.charCodeAt(0)),
      }, i.signatureId);
    },
  };
}
