import type { TxClient } from '@cadencia/db';

export interface ExportFieldValue {
  readonly labelSnapshot: string;
  readonly displaySnapshot: string | null;
  readonly ordinal: number;
  readonly texto: string;
}

export interface ExportVersion {
  readonly versionId: string;
  readonly versionNo: number;
  readonly kind: string;
  readonly finalizedAt: string;
  readonly authorNome: string;
  readonly incompleto: boolean;
  readonly superseded: boolean;
  readonly tachado: boolean;
  readonly justificativaDaSuperssao: string | null;
  readonly campos: readonly ExportFieldValue[];
  readonly diagnosticos: readonly { code: string; display: string }[];
}

export interface ExportBlock {
  readonly encounterId: string;
  readonly occurredDate: string;
  readonly clinicaNome: string;
  readonly versoes: readonly ExportVersion[];
}

export interface ExportAttachment {
  readonly attachmentId: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly occurredDate: string | null;
  readonly sha256Hex: string;
}

export interface ExportDocument {
  readonly documentId: string;
  readonly kind: string;
  readonly issuedDate: string;
  readonly pdfKey: string | null;
  readonly assinado: boolean;
}

export interface CollectedRecord {
  readonly patientId: string;
  readonly blocos: readonly ExportBlock[];
  readonly anexos: readonly ExportAttachment[];
  readonly documentos: readonly ExportDocument[];
}

export interface CollectInput {
  readonly patientId: string;
  readonly from?: string;
  readonly to?: string;
}

export async function collectRecord(
  tx: TxClient, i: CollectInput,
): Promise<CollectedRecord> {
  await tx.query(`SELECT audit.log_read('record_export', $1)`, [i.patientId]);

  const versoes = await tx.query<{
    encounter_id: string; occurred_date: string; clinica_nome: string;
    version_id: string; version_no: number; kind: string; finalized_at: string;
    author_nome: string; incompleto: boolean; superseded: boolean;
    justificativa_super: string | null;
  }>(
    `SELECT e.id AS encounter_id, e.occurred_date::text AS occurred_date,
            c.nome AS clinica_nome,
            v.id AS version_id, v.version_no, v.kind::text AS kind,
            to_char(v.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finalized_at,
            u.full_name AS author_nome, v.incompleto, v.superseded,
            sup.justificativa AS justificativa_super
       FROM clin.encounter e
       JOIN app.clinic c ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN clin.v_version_status v ON (v.tenant_id, v.encounter_id) = (e.tenant_id, e.id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (v.tenant_id, v.author_professional_id)
       JOIN id."user" u ON u.id = p.user_id
       LEFT JOIN clin.encounter_version sup ON sup.id = v.superseded_by
      WHERE e.patient_id = $1
        AND ($2::date IS NULL OR e.occurred_date >= $2::date)
        AND ($3::date IS NULL OR e.occurred_date <= $3::date)
      ORDER BY e.occurred_date, e.id, v.version_no`,
    [i.patientId, i.from ?? null, i.to ?? null]);

  const campos = await tx.query<{
    version_id: string; label_snapshot: string; display_snapshot: string | null;
    ordinal: number; texto: string }>(
    `SELECT f.version_id, f.label_snapshot, f.display_snapshot, f.ordinal,
            coalesce(f.value_text, f.value_num::text, f.value_bool::text,
                     f.value_date::text, f.value_ref_code, f.value_json::text, '') AS texto
       FROM clin.encounter_field_value f
       JOIN clin.encounter_version v ON (v.tenant_id, v.id) = (f.tenant_id, f.version_id)
       JOIN clin.encounter e ON (e.tenant_id, e.id) = (v.tenant_id, v.encounter_id)
      WHERE e.patient_id = $1
      ORDER BY f.version_id, f.section_instance, f.ordinal`, [i.patientId]);

  const cids = await tx.query<{ version_id: string; code: string; display: string }>(
    `SELECT version_id, code, display_snapshot AS display FROM clin.diagnosis
      WHERE patient_id = $1 ORDER BY version_id, code`, [i.patientId]);

  const anexos = await tx.query<{
    id: string; storage_key: string; original_name: string; content_type: string;
    occurred_date: string | null; sha: string }>(
    `SELECT id, storage_key, original_name, content_type,
            occurred_date::text AS occurred_date, encode(sha256,'hex') AS sha
       FROM clin.attachment
      WHERE patient_id = $1 AND purged_at IS NULL
      ORDER BY occurred_date NULLS LAST, created_at`, [i.patientId]);

  const docs = await tx.query<{
    id: string; kind: string; issued_date: string; pdf_key: string | null; assinado: boolean }>(
    `SELECT id, kind::text AS kind, issued_date::text AS issued_date, pdf_key,
            signature_id IS NOT NULL AS assinado
       FROM clin.document WHERE patient_id = $1 ORDER BY issued_date, created_at`,
    [i.patientId]);

  const camposPorVersao = new Map<string, ExportFieldValue[]>();
  for (const c of campos.rows) {
    const lista = camposPorVersao.get(c.version_id) ?? [];
    lista.push({ labelSnapshot: c.label_snapshot, displaySnapshot: c.display_snapshot,
                 ordinal: c.ordinal, texto: c.texto });
    camposPorVersao.set(c.version_id, lista);
  }
  const cidsPorVersao = new Map<string, { code: string; display: string }[]>();
  for (const c of cids.rows) {
    const lista = cidsPorVersao.get(c.version_id) ?? [];
    lista.push({ code: c.code, display: c.display });
    cidsPorVersao.set(c.version_id, lista);
  }

  const blocos = new Map<string, ExportBlock & { versoes: ExportVersion[] }>();
  for (const v of versoes.rows) {
    const bloco = blocos.get(v.encounter_id) ?? {
      encounterId: v.encounter_id, occurredDate: v.occurred_date,
      clinicaNome: v.clinica_nome, versoes: [] as ExportVersion[],
    };
    bloco.versoes.push({
      versionId: v.version_id, versionNo: v.version_no, kind: v.kind,
      finalizedAt: v.finalized_at, authorNome: v.author_nome, incompleto: v.incompleto,
      superseded: v.superseded,
      tachado: v.superseded,
      justificativaDaSuperssao: v.justificativa_super,
      campos: camposPorVersao.get(v.version_id) ?? [],
      diagnosticos: cidsPorVersao.get(v.version_id) ?? [],
    });
    blocos.set(v.encounter_id, bloco);
  }

  return {
    patientId: i.patientId,
    blocos: [...blocos.values()],
    anexos: anexos.rows.map((a) => ({
      attachmentId: a.id, storageKey: a.storage_key, originalName: a.original_name,
      contentType: a.content_type, occurredDate: a.occurred_date, sha256Hex: a.sha })),
    documentos: docs.rows.map((d) => ({
      documentId: d.id, kind: d.kind, issuedDate: d.issued_date,
      pdfKey: d.pdf_key, assinado: d.assinado })),
  };
}
