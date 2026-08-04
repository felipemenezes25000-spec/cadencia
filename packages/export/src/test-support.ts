import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeExport {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string;
  sectionId: string; fieldId: string;
  encounterId1: string; encounterId2: string;
  versionId1: string; versionId2: string; versionId3: string;
  attachmentId1: string; attachmentId2: string;
  documentId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

export async function semearProntuarioCompleto(): Promise<SementeExport> {
  const s: SementeExport = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    sectionId: uuidv7(), fieldId: uuidv7(),
    encounterId1: uuidv7(), encounterId2: uuidv7(),
    versionId1: uuidv7(), versionId2: uuidv7(), versionId3: uuidv7(),
    attachmentId1: uuidv7(), attachmentId2: uuidv7(),
    documentId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Export', '12ABC34503DE37')`,
      [s.tenantId, `x-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Export', '2077501', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr Export')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Export', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
       VALUES ($1, $2, 'anamnese', 'Anamnese', 1)`,
      [s.tenantId, s.sectionId]);
    await c.query(
      `INSERT INTO clin.record_field
         (tenant_id, id, section_id, code, label, kind, ordinal)
       VALUES ($1, $2, $3, 'queixa_principal', 'Queixa principal', 'texto_longo', 1)`,
      [s.tenantId, s.fieldId, s.sectionId]);

    // Encounter 1: junho/2026
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-06-15T10:00:00Z',
               app.local_date(TIMESTAMPTZ '2026-06-15T10:00:00Z',
                              (SELECT timezone FROM app.clinic WHERE id = $5)))`,
      [s.tenantId, s.encounterId1, s.patientId, s.professionalId, s.clinicId]);

    // Encounter 2: agosto/2026
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T14:00:00Z',
               app.local_date(TIMESTAMPTZ '2026-08-01T14:00:00Z',
                              (SELECT timezone FROM app.clinic WHERE id = $5)))`,
      [s.tenantId, s.encounterId2, s.patientId, s.professionalId, s.clinicId]);

    // Version 1: original do encounter 1
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('versao original export'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId1, s.encounterId1, s.userId, s.professionalId]);

    // Version 2: adendo do encounter 2
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('versao adendo export'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId2, s.encounterId2, s.userId, s.professionalId]);

    // Version 3: retificação que supersedes version 1
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, supersedes_version_id,
          justificativa, author_user_id, author_professional_id, content_hash,
          serializer_version)
       VALUES ($1, $2, $3, 2, 'retificacao', $4,
               'paciente errado na primeira versao', $5, $6,
               sha256('versao retificacao export'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId3, s.encounterId1, s.versionId1,
       s.userId, s.professionalId]);

    // Attachment 1: resultado de exame em junho
    await c.query(
      `INSERT INTO clin.attachment
         (tenant_id, id, patient_id, encounter_id, version_id, kind, storage_key,
          original_name, content_type, size_bytes, sha256, dek_ref, occurred_date,
          created_by)
       VALUES ($1, $2, $3, $4, $5, 'resultado_exame', gen_random_uuid(),
               'hemograma_202606.pdf', 'application/pdf', 102400,
               sha256('att1 export'::bytea), 'dek:exp:2026-06',
               DATE '2026-06-10', $6)`,
      [s.tenantId, s.attachmentId1, s.patientId, s.encounterId1,
       s.versionId1, s.userId]);

    // Attachment 2: imagem em agosto
    await c.query(
      `INSERT INTO clin.attachment
         (tenant_id, id, patient_id, encounter_id, version_id, kind, storage_key,
          original_name, content_type, size_bytes, sha256, dek_ref, occurred_date,
          created_by)
       VALUES ($1, $2, $3, $4, $5, 'imagem', gen_random_uuid(),
               'rx_torax.dcm', 'application/dicom', 512000,
               sha256('att2 export'::bytea), 'dek:exp:2026-08',
               DATE '2026-08-01', $6)`,
      [s.tenantId, s.attachmentId2, s.patientId, s.encounterId2,
       s.versionId2, s.userId]);

    // Document: atestado
    await c.query(
      `INSERT INTO clin.document
         (tenant_id, id, kind, patient_id, professional_id, clinic_id,
          encounter_id, version_id, issued_date, payload, content_hash,
          canonical_version, created_by)
       VALUES ($1, $2, 'atestado', $3, $4, $5,
               $6, $7, DATE '2026-08-01',
               '{"texto":"Atesto para devidos fins"}'::jsonb,
               sha256('doc export'::bytea), 'jcs-1', $4::uuid)`,
      [s.tenantId, s.documentId, s.patientId, s.professionalId,
       s.clinicId, s.encounterId2, s.versionId2]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
