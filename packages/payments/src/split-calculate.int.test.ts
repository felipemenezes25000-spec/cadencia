// packages/payments/src/split-calculate.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeCalculo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
  procedureId2: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCalculo(): Promise<SementeCalculo> {
  const s: SementeCalculo = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(),
    procedureId: uuidv7(), procedureId2: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Calculo', '22ABC34501DE35')`,
      [s.tenantId, `c-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Calculo', '2345678', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Calculo')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Calculo', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000),
              ($1, $3, 'RETORNO', 'Retorno', '#5fa02f', 15, 10000)`,
      [s.tenantId, s.procedureId, s.procedureId2]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
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

let s: SementeCalculo;
let actor: Actor;

beforeAll(async () => {
  s = await semearCalculo();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.calculate_splits — resolve regra mais especifica', () => {
  it('aplica regra default quando so existe uma regra generica', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 40.00, 1)`,
        [ruleId, s.professionalId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta default', 10000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `calc-default-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        status: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text,
                status::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // 40% de 10000 = 4000 para o profissional
    expect(rows[0]).toEqual({
      professional_share_cents: '4000',
      clinic_share_cents: '6000',
      status: 'pendente',
    });
  });

  it('aplica regra especifica (professional + procedure) em vez da default', async () => {
    const entryId = uuidv7();
    const ruleDefault = uuidv7();
    const ruleEspecifica = uuidv7();
    const appointmentId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      // Regra default: 30%
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 30.00, 1)
         ON CONFLICT DO NOTHING`,
        [ruleDefault, s.professionalId]);

      // Regra específica com procedure: 60%
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, 60.00, 10)`,
        [ruleEspecifica, s.professionalId, s.procedureId]);

      await tx.query(
        `INSERT INTO sched.appointment
           (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
            starts_at, ends_at, appointment_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 '2026-10-20T09:00:00Z', '2026-10-20T09:30:00Z', '2026-10-20',
                 'atendido', $7)`,
        [appointmentId, s.tenantId, s.patientId, s.professionalId,
         s.clinicId, s.procedureId, s.userId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            appointment_id, description, amount_cents, payment_method_id,
            paid_at, status, idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 $5, 'Consulta especifica', 20000, $6,
                 clock_timestamp(), 'pago', $7, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         appointmentId, s.paymentMethodId, `calc-spec-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        split_rule_id: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text,
                split_rule_id::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // 60% de 20000 = 12000 para o profissional
    expect(rows[0]!.professional_share_cents).toBe('12000');
    expect(rows[0]!.clinic_share_cents).toBe('8000');
    expect(rows[0]!.split_rule_id).toBe(ruleEspecifica);
  });

  it('aplica valor fixo quando fixed_amount_cents e definido', async () => {
    const entryId = uuidv7();
    const ruleFixo = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id,
            fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 8000, 15)`,
        [ruleFixo, s.professionalId, s.procedureId2]);

      const appId = uuidv7();
      await tx.query(
        `INSERT INTO sched.appointment
           (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
            starts_at, ends_at, appointment_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 '2026-10-21T10:00:00Z', '2026-10-21T10:15:00Z', '2026-10-21',
                 'atendido', $7)`,
        [appId, s.tenantId, s.patientId, s.professionalId,
         s.clinicId, s.procedureId2, s.userId]);

      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            appointment_id, description, amount_cents, payment_method_id,
            paid_at, status, idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 $5, 'Retorno fixo', 10000, $6,
                 clock_timestamp(), 'pago', $7, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         appId, s.paymentMethodId, `calc-fixed-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(rows).toHaveLength(1);
    // Fixo: 8000 para o profissional, 2000 para a clínica
    expect(rows[0]).toEqual({
      professional_share_cents: '8000',
      clinic_share_cents: '2000',
    });
  });

  it('nao insere split quando nao existe regra para o profissional', async () => {
    const otherProfId = uuidv7();
    const otherUserId = uuidv7();
    const entryId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro Medico')`,
        [otherUserId, `${otherUserId}@example.test`]);
      await c.query(
        `INSERT INTO app.professional
           (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
         VALUES ($1, $2, $3, '06', '111222', 'MG', '225125')`,
        [s.tenantId, otherProfId, otherUserId]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
        [s.tenantId, otherUserId, s.clinicId]);
      await c.query('COMMIT');
    } finally {
      c.release();
      await admin.end();
    }

    const otherActor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: otherUserId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };

    await withTenantTx(otherActor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Sem regra', 15000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, otherProfId, s.clinicId, s.patientId,
         s.paymentMethodId, `calc-norule-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`,
        [entryId]));
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe('schema fin — repasse_statement', () => {
  it('insere extrato de repasse', async () => {
    const stmtId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.repasse_statement
           (tenant_id, id, professional_id, clinic_id, period_start, period_end,
            total_entries, total_professional_share, total_clinic_share, status)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 '2026-10-01', '2026-10-31', 5, 50000, 75000, 'aberto')`,
        [stmtId, s.professionalId, s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        total_professional_share: string; status: string;
      }>(
        `SELECT total_professional_share::text, status::text
           FROM fin.repasse_statement WHERE id = $1`,
        [stmtId]));
    expect(rows[0]).toEqual({
      total_professional_share: '50000',
      status: 'aberto',
    });
  });
});
