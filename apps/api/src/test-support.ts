import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { createSession, newCsrfToken, type Role } from '@cadencia/authn';

export interface SementeSessao {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  patientPreliminarId: string;
  procedureId: string;
  appointmentId: string;
  token: string;
  csrf: string;
  clinicIdDeOutroTenant: string;
}

export function auth(s: SementeSessao) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

export async function semearSessao(
  opts: { role?: Role } = {},
): Promise<SementeSessao> {
  const role = opts.role ?? 'admin_clinico';
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const patientPreliminarId = uuidv7();
  const procedureId = uuidv7();
  const appointmentId = uuidv7();
  const tenantB = uuidv7();
  const clinicB = uuidv7();
  const csrf = newCsrfToken();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Sessao', '11111111000190')`,
      [tenantId, `sess-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Sessao', '2077502', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Dr Sessao')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, $4)`,
      [tenantId, userId, clinicId, role]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Sessao', 'completo', '1990-01-15')`,
      [tenantId, patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
       VALUES ($1, $2, 'CONS01', 'Consulta Padrao', '#3b82f6', 30)`,
      [tenantId, procedureId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Preliminar', 'preliminar')`,
      [tenantId, patientPreliminarId]);
    await c.query(
      `INSERT INTO sched.appointment
         (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-12-15T10:00:00Z', '2026-12-15T10:30:00Z', '2026-12-15', $7)`,
      [tenantId, appointmentId, patientId, professionalId, clinicId, procedureId, userId]);

    // Tenant B — para testar vinculo cruzado
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica B', '22222222000191')`,
      [tenantB, `sessb-${tenantB.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade B', '2077503', 'America/Sao_Paulo')`,
      [tenantB, clinicB]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  const { token } = await createSession(admin, {
    userId, activeTenantId: tenantId, activeClinicId: clinicId,
  });

  await admin.end();

  return {
    tenantId, clinicId, userId, professionalId, patientId, patientPreliminarId,
    procedureId, appointmentId, token, csrf, clinicIdDeOutroTenant: clinicB,
  };
}
