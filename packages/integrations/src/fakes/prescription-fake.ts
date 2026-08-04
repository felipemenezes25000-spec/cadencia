import { createHash, randomBytes } from 'node:crypto';
import { asRfc3339, failure, success, type ProviderCtx, type Rfc3339 } from '../contracts/common';
import type {
  PrescriberSession, PrescriptionProvider, PrescriptionRecord,
} from '../contracts/prescription';

export interface FakePrescriptionOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
  readonly tokenJaVencido?: boolean;
  readonly comEstruturados?: boolean;
}

export function createFakePrescriptionProvider(
  opts: FakePrescriptionOptions = {},
): PrescriptionProvider {
  const modo = opts.modo ?? 'ok';

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'parceiro fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(new Date().toISOString()) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'prescription-fake',
    capabilities: new Set(['embedded', 'signed-artifact',
                           ...(opts.comEstruturados === true ? ['structured'] : [])]),
    safety: { openPrescriberSession: 'idempotent', fetchPrescription: 'safe',
              fetchSignedArtifact: 'safe' },

    async health() { return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() }; },

    async openPrescriberSession(ctx: ProviderCtx, i) {
      const f = falha<PrescriberSession>();
      if (f) return f;
      if (opts.tokenJaVencido === true) {
        return failure<PrescriberSession>({ kind: 'misconfigured', retrySafe: false,
          detail: 'token do prescritor ja vencido: reautorize o profissional' });
      }
      const expira = new Date(Date.now() + 15 * 60_000).toISOString();
      return success<PrescriberSession>({
        mode: 'embedded',
        scriptUrl: 'https://parceiro.fake/modulo.js',
        token: randomBytes(16).toString('hex'),
        expiresAt: asRfc3339(expira) ?? agora(),
        patientPayload: { nome: i.patient.fullName, nascimento: i.patient.birthDate ?? '' },
        correlationId: ctx.idempotencyKey,
      }, `fake-session-${ctx.idempotencyKey}`);
    },

    async fetchPrescription(_ctx, i) {
      const f = falha<PrescriptionRecord>();
      if (f) return f;
      return success<PrescriptionRecord>({
        providerPrescriptionId: i.providerPrescriptionId,
        createdAt: agora(),
        patientLinkUrl: `https://parceiro.fake/r/${i.providerPrescriptionId}`,
        validationCode: '482913',
        pdfUrl: `https://parceiro.fake/pdf/${i.providerPrescriptionId}`,
        items: [{
          nome: 'Losartana potássica 50 mg',
          principioAtivo: 'losartana potássica', concentracao: '50 mg',
          forma: 'comprimido', quantidade: '30',
          posologia: '1 comprimido pela manhã, uso contínuo',
          ehControlado: false,
        }],
        structured: opts.comEstruturados === true
          ? { cid: 'I10', categoria: 'anti-hipertensivo' }
          : null,
      }, `fake-rx-${i.providerPrescriptionId}`);
    },

    async fetchSignedArtifact(_ctx, i) {
      const f = falha<{ bytes: Uint8Array; sha256: string }>();
      if (f) return f;
      const bytes = new TextEncoder().encode(`%PDF-1.7 fake ${i.providerPrescriptionId}`);
      return success({
        bytes, sha256: createHash('sha256').update(bytes).digest('hex'),
      }, `fake-artifact-${i.providerPrescriptionId}`);
    },
  };
}
