import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeRx {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string;
  encounterId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearPrescricao(): Promise<SementeRx> {
  const s: SementeRx = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    encounterId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Rx', '12ABC34504DE38')`,
      [s.tenantId, `rx-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rx', '2077502', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr Rx')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Rx', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'))`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId]);
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
