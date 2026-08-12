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
  patientNome: string;
  patientCpf: string;
  procedureId: string;
  appointmentId: string;
  encounterId: string;
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
  opts: { role?: Role; comMfa?: boolean } = {},
): Promise<SementeSessao> {
  const role = opts.role ?? 'admin_clinico';
  const comMfa = opts.comMfa ?? true;
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const patientPreliminarId = uuidv7();
  const procedureId = uuidv7();
  const appointmentId = uuidv7();
  const encounterId = uuidv7();
  const tenantB = uuidv7();
  const clinicB = uuidv7();
  const csrf = newCsrfToken();
  const cpf = `${Math.floor(Math.random() * 90000000000 + 10000000000)}`;
  const nome = 'Paciente Sessao';

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
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date, search_digits)
       VALUES ($1, $2, $3, 'completo', '1990-01-15', $4)`,
      [tenantId, patientId, nome, cpf]);
    await c.query(
      `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
       VALUES ($1, gen_random_uuid(), $2, 'CPF', $3)`,
      [tenantId, patientId, cpf]);
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

    // Encounter for clinical artifact tests
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)`,
      [tenantId, encounterId, patientId, professionalId, clinicId]);

    // Tenant B — para testar vínculo cruzado
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

  if (comMfa) {
    await admin.query(
      `UPDATE id.session SET mfa_at = clock_timestamp()
        WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }

  await admin.end();

  return {
    tenantId, clinicId, userId, professionalId, patientId, patientPreliminarId,
    patientNome: nome, patientCpf: cpf, procedureId, appointmentId, encounterId,
    token, csrf, clinicIdDeOutroTenant: clinicB,
  };
}

/**
 * Um SEGUNDO profissional dentro do MESMO tenant e da mesma unidade.
 *
 * `semearSessao` sempre cria um tenant novo, o que é certo para isolamento mas
 * inútil para testar o que separa dois médicos da mesma clínica: a política
 * RESTRICTIVE `clinical_scope`. Entre tenants a RLS já barra por outro caminho,
 * e o teste passaria sem provar nada.
 *
 * Serve para compartilhamento de prontuário, quebra-vidro e transferência.
 */
export async function semearColega(
  dono: SementeSessao, opts: { role?: Role } = {},
): Promise<SementeSessao> {
  const role = opts.role ?? 'profissional';
  const userId = uuidv7();
  const professionalId = uuidv7();
  const csrf = newCsrfToken();
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  try {
    await admin.query(
      `INSERT INTO id."user" (id, email, full_name, cpf)
       VALUES ($1, $2, 'Dr. Colega', NULL)`,
      [userId, `colega-${userId.slice(0, 13)}@teste.local`]);
    await admin.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [dono.tenantId, uuidv7(), userId, dono.clinicId, role]);
    await admin.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho)
       VALUES ($1,$2,$3,'06','999888','SP')`,
      [dono.tenantId, professionalId, userId]);

    const { token } = await createSession(admin, {
      userId, activeTenantId: dono.tenantId, activeClinicId: dono.clinicId,
    });
    await admin.query(
      `UPDATE id.session SET mfa_at = clock_timestamp()
        WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

    return { ...dono, userId, professionalId, token, csrf };
  } finally {
    await admin.end();
  }
}
