import { createHash } from 'node:crypto';
import { ok, uuidv7, CANONICAL_VERSION, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import {
  asStorageKey, type ProviderCtx, type SignatureProvider,
} from '@cadencia/integrations';

export type SubjectKind = 'encounter_version' | 'document' | 'prescription';

export interface SignSubjectInput {
  readonly provider: SignatureProvider;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly canonicalPayload: Uint8Array;
  readonly signerRef: string;
  readonly signerCpf: string;
  readonly clinicId: string;
  readonly otp?: string;
  readonly deadlineMs?: number;
}

export type SignOutcome =
  | { estado: 'assinado'; signatureId: string; verifiedStatus: string }
  | { estado: 'pendente'; motivo: string };

const POLICY_OID_AD_RT = '2.16.76.1.7.1.2.2.3';

export async function signSubject(
  tx: TxClient, i: SignSubjectInput,
): Promise<Result<SignOutcome, never>> {
  const hash = createHash('sha256').update(i.canonicalPayload).digest();
  const canonicalKey = uuidv7();

  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    idempotencyKey: `${i.subjectKind}:${i.subjectId}`,
    deadlineMs: i.deadlineMs ?? 3000,
  };

  const r = await i.provider.sign(ctx, {
    signerRef: i.signerRef,
    ...(i.otp === undefined ? {} : { otp: i.otp }),
    documents: [{
      documentId: i.subjectId,
      hashAlgorithm: 'SHA-256',
      hashBase64: hash.toString('base64'),
      canonicalPayloadKey: asStorageKey(canonicalKey),
      canonicalVersion: CANONICAL_VERSION,
      policy: 'AD_RT_CAdES_2.4',
      detached: true,
    }],
  });

  if (!r.ok) {
    await tx.query(
      `INSERT INTO clin.signature_pending
         (id, clinic_id, subject_kind, subject_id, canonical_key, hash,
          signer_user_id, motivo, detalhe, precisa_reconciliar)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id(), $7, $8, $9)
       ON CONFLICT (tenant_id, subject_kind, subject_id) WHERE resolved_at IS NULL
       DO UPDATE SET tentativas = clin.signature_pending.tentativas + 1`,
      [uuidv7(), i.clinicId, i.subjectKind, i.subjectId, canonicalKey, hash,
       r.error.kind, r.error.detail,
       r.error.kind === 'timeout']);
    await tx.query(
      `SELECT audit.log('SIGNATURE_PENDING', 'clin', 'signature_pending', $1, 'erro',
                        jsonb_build_object('motivo', $2::text), $3)`,
      [i.subjectId, r.error.kind, i.clinicId]);
    return ok({ estado: 'pendente', motivo: r.error.kind });
  }

  const assinado = r.value[0];
  if (assinado === undefined) return ok({ estado: 'pendente', motivo: 'unsupported' });

  const v = await i.provider.verify({
    canonicalPayload: i.canonicalPayload, signatureP7s: assinado.signatureP7s });
  const status = v.ok ? v.value.status : 'indeterminada';

  const signatureId = uuidv7();
  const ltvKey = uuidv7();
  await tx.query(
    `INSERT INTO clin.signature (
        id, subject_kind, subject_id, canonical_key, canonical_version, hash,
        policy_oid, standard, psc, signer_user_id, signer_cpf, cert_serial,
        cert_not_after, pkcs7, timestamp_token, ltv_material_key,
        verified_status, verified_at, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'AD_RT', $8, app.current_user_id(), $9, $10,
             $11::timestamptz, $12, $13, $14, $15, clock_timestamp(), $16::timestamptz)`,
    [signatureId, i.subjectKind, i.subjectId, canonicalKey, CANONICAL_VERSION, hash,
     POLICY_OID_AD_RT, i.provider.id, i.signerCpf, 'ver-ltv',
     '2046-01-01T00:00:00.000Z',
     Buffer.from(assinado.signatureP7s), Buffer.from(assinado.timestampToken), ltvKey,
     status, assinado.signedAt]);

  await tx.query(
    `UPDATE clin.signature_pending SET resolved_at = clock_timestamp(), signature_id = $2
      WHERE subject_kind = $3 AND subject_id = $1 AND resolved_at IS NULL`,
    [i.subjectId, signatureId, i.subjectKind]);

  await tx.query(
    `SELECT audit.log('DOCUMENT_SIGN', 'clin', 'signature', $1, 'sucesso',
                      jsonb_build_object('standard', 'AD_RT', 'verificacao', $2::text), $3)`,
    [signatureId, status, i.clinicId]);

  return ok({ estado: 'assinado', signatureId, verifiedStatus: status });
}

export interface PendingSignature {
  readonly pendingId: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly motivo: string;
  readonly precisaReconciliar: boolean;
  readonly tentativas: number;
}

export async function pendingSignatures(
  tx: TxClient, clinicId: string,
): Promise<PendingSignature[]> {
  const { rows } = await tx.query<{
    id: string; subject_kind: SubjectKind; subject_id: string; motivo: string;
    precisa_reconciliar: boolean; tentativas: number }>(
    `SELECT id, subject_kind, subject_id, motivo, precisa_reconciliar, tentativas
       FROM clin.signature_pending
      WHERE clinic_id = $1 AND resolved_at IS NULL
      ORDER BY created_at`, [clinicId]);
  return rows.map((r) => ({
    pendingId: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id,
    motivo: r.motivo, precisaReconciliar: r.precisa_reconciliar, tentativas: r.tentativas,
  }));
}
