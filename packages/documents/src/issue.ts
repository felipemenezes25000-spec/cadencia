import {
  CANONICAL_VERSION, canonicalBytes, canonicalHash, ok, uuidv7,
  type JsonValue, type Result,
} from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { SignatureProvider } from '@cadencia/integrations';
import { signSubject, type SignOutcome } from './sign';

export type DocumentKind =
  'atestado' | 'pedido_exame' | 'relatorio' | 'declaracao_comparecimento';

export interface DocumentCanonicalInput {
  readonly kind: DocumentKind;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly issuedDate: string;
  readonly payload: JsonValue;
}

export interface DocumentCanonical extends Record<string, JsonValue> {
  readonly schema: 'cadencia.document';
  readonly canonicalVersion: string;
  readonly kind: DocumentKind;
}

export function buildDocumentCanonical(i: DocumentCanonicalInput): DocumentCanonical {
  return {
    schema: 'cadencia.document',
    canonicalVersion: CANONICAL_VERSION,
    kind: i.kind,
    patientId: i.patientId,
    professionalId: i.professionalId,
    clinicId: i.clinicId,
    issuedDate: i.issuedDate,
    payload: i.payload,
  } as DocumentCanonical;
}

export interface IssueDocumentInput extends DocumentCanonicalInput {
  readonly provider: SignatureProvider;
  readonly encounterId?: string;
  readonly versionId?: string;
  readonly signerRef: string;
  readonly signerCpf: string;
}

export interface IssuedDocument {
  readonly documentId: string;
  readonly contentHashHex: string;
  readonly assinatura: SignOutcome;
}

export async function issueDocument(
  tx: TxClient, i: IssueDocumentInput,
): Promise<Result<IssuedDocument, never>> {
  const canonical = buildDocumentCanonical(i);
  const bytes = canonicalBytes(canonical);
  const hash = canonicalHash(canonical);
  const documentId = uuidv7();

  await tx.query(
    `INSERT INTO clin.document (
        id, kind, patient_id, professional_id, clinic_id, encounter_id, version_id,
        issued_date, payload, content_hash, canonical_version, created_by)
     VALUES ($1, $2::clin.document_kind, $3, $4, $5, $6, $7, $8::date, $9::jsonb, $10, $11,
             app.current_user_id())`,
    [documentId, i.kind, i.patientId, i.professionalId, i.clinicId,
     i.encounterId ?? null, i.versionId ?? null, i.issuedDate,
     JSON.stringify(i.payload), hash, CANONICAL_VERSION]);

  const assinatura = await signSubject(tx, {
    provider: i.provider,
    subjectKind: 'document', subjectId: documentId,
    canonicalPayload: bytes,
    signerRef: i.signerRef, signerCpf: i.signerCpf, clinicId: i.clinicId,
  });

  if (assinatura.ok && assinatura.value.estado === 'assinado') {
    await tx.query(
      `UPDATE clin.document SET signature_id = $2 WHERE id = $1`,
      [documentId, assinatura.value.signatureId]);
  }

  await tx.query(
    `SELECT audit.log('DOCUMENT_ISSUE', 'clin', 'document', $1, 'sucesso',
                      jsonb_build_object('kind', $2::text), $3)`,
    [documentId, i.kind, i.clinicId]);

  return ok({
    documentId,
    contentHashHex: hash.toString('hex'),
    assinatura: assinatura.ok ? assinatura.value : { estado: 'pendente', motivo: 'unsupported' },
  });
}
