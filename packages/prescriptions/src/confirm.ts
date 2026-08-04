import { createHash } from 'node:crypto';
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  PrescriptionProvider, ProviderCtx, SignatureProvider,
} from '@cadencia/integrations';
import type { PrescriptionFailure } from './session';

export interface ConfirmInput {
  readonly prescriptionProvider: PrescriptionProvider;
  readonly signatureProvider: SignatureProvider;
  readonly providerPrescriptionId: string;
  readonly encounterId: string;
  readonly versionId?: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly signerRef: string;
  readonly signerCpf: string;
}

export interface ConfirmedPrescription {
  readonly prescriptionId: string;
  readonly itens: number;
  readonly assinaturaVerificada: boolean;
}

export async function confirmPrescription(
  tx: TxClient, i: ConfirmInput,
): Promise<Result<ConfirmedPrescription, PrescriptionFailure>> {
  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    idempotencyKey: `rx:${i.providerPrescriptionId}`, deadlineMs: 8000,
  };

  const rec = await i.prescriptionProvider.fetchPrescription(ctx, {
    providerPrescriptionId: i.providerPrescriptionId });
  if (!rec.ok) {
    if (rec.error.kind === 'rejected') {
      return err({ kind: 'parceiro_recusou', code: rec.error.code });
    }
    return err({ kind: 'parceiro_indisponivel', retrySafe: rec.error.retrySafe });
  }

  const art = await i.prescriptionProvider.fetchSignedArtifact(ctx, {
    providerPrescriptionId: i.providerPrescriptionId });
  if (!art.ok) return err({ kind: 'artefato_assinado_indisponivel' });

  const v = await i.signatureProvider.verify({
    canonicalPayload: art.value.bytes,
    signatureP7s: art.value.detachedP7s ?? art.value.bytes });
  const assinaturaVerificada = v.ok && v.value.status === 'valida';

  const prescriptionId = uuidv7();
  const pdfKey = uuidv7();
  const sha = createHash('sha256').update(art.value.bytes).digest();

  const ins = await tx.query<{ id: string }>(
    `INSERT INTO clin.prescription (
        id, patient_id, professional_id, clinic_id, encounter_id, version_id,
        issued_date, provider, provider_prescription_id, patient_link_url,
        validation_code, pdf_key, pdf_sha256, structured_cid, structured_categoria,
        created_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             app.local_date(clock_timestamp(),
               (SELECT c.timezone FROM app.clinic c WHERE c.id = $4)),
             $7, $8, $9, $10, $11, $12, $13, $14, app.current_user_id())
     ON CONFLICT (tenant_id, provider, provider_prescription_id) DO NOTHING
     RETURNING id`,
    [prescriptionId, i.patientId, i.professionalId, i.clinicId, i.encounterId,
     i.versionId ?? null, i.prescriptionProvider.id, i.providerPrescriptionId,
     rec.value.patientLinkUrl, rec.value.validationCode, pdfKey, sha,
     rec.value.structured?.cid ?? null, rec.value.structured?.categoria ?? null]);

  const criado = ins.rows[0];
  if (!criado) {
    const ja = await tx.query<{ id: string; n: number }>(
      `SELECT p.id, (SELECT count(*)::int FROM clin.prescription_item i
                      WHERE i.prescription_id = p.id) AS n
         FROM clin.prescription p
        WHERE p.provider = $1 AND p.provider_prescription_id = $2`,
      [i.prescriptionProvider.id, i.providerPrescriptionId]);
    const linha = ja.rows[0];
    return ok({ prescriptionId: linha?.id ?? prescriptionId,
                itens: linha?.n ?? 0, assinaturaVerificada });
  }

  for (const [indice, item] of rec.value.items.entries()) {
    await tx.query(
      `INSERT INTO clin.prescription_item (
          id, prescription_id, ordinal, nome, principio_ativo, concentracao,
          forma, quantidade, posologia, eh_controlado)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [prescriptionId, indice, item.nome, item.principioAtivo, item.concentracao,
       item.forma, item.quantidade, item.posologia, item.ehControlado]);
  }

  await tx.query(
    `SELECT audit.log('PRESCRIPTION_CONFIRM', 'clin', 'prescription', $1, 'sucesso',
                      jsonb_build_object('provedor', $2::text, 'itens', $3::int,
                                         'assinatura_valida', $4::boolean), $5)`,
    [prescriptionId, i.prescriptionProvider.id, rec.value.items.length,
     assinaturaVerificada, i.clinicId]);

  return ok({ prescriptionId, itens: rec.value.items.length, assinaturaVerificada });
}
