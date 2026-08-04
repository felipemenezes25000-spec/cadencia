import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeWorker {
  tenantId: string;
  encounterId: string;
  encounterRecenteId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

export async function semearRascunhoAntigo(): Promise<SementeWorker> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const encounterId = uuidv7();
  const encounterRecenteId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Worker Test', '33333333000193')`,
      [tenantId, `wk-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Worker', '2077504', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr Worker')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [tenantId, userId, clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Worker', 'completo', '1985-06-20')`,
      [tenantId, patientId]);

    // Encounter with old draft (10 days ago)
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5,
               clock_timestamp() - interval '10 days',
               (clock_timestamp() - interval '10 days')::date)`,
      [tenantId, encounterId, patientId, professionalId, clinicId]);
    await c.query(
      `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, rev, updated_by, updated_at)
       VALUES ($1, $2, '{"queixa":"dor"}'::jsonb, 1, $3,
               clock_timestamp() - interval '10 days')`,
      [tenantId, encounterId, userId]);

    // Recent encounter (should NOT be finalized)
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)`,
      [tenantId, encounterRecenteId, patientId, professionalId, clinicId]);
    await c.query(
      `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, rev, updated_by)
       VALUES ($1, $2, '{"queixa":"recente"}'::jsonb, 1, $3)`,
      [tenantId, encounterRecenteId, userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  await admin.end();
  return { tenantId, encounterId, encounterRecenteId };
}
