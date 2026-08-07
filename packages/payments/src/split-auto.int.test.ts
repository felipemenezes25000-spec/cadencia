// packages/payments/src/split-auto.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment } from './record-payment';

interface SementeAuto {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
  appointmentId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearAuto(): Promise<SementeAuto> {
  const s: SementeAuto = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(), procedureId: uuidv7(),
    appointmentId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Auto', '66ABC34501DE35')`,
      [s.tenantId, `a-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Auto', '6789012', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Auto')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111999', 'PR', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Auto', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-11-10T14:00:00Z', '2026-11-10T14:30:00Z', '2026-11-10',
               'atendido', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, s.procedureId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
    // Regra de repasse: 50% para consulta
    await c.query(
      `SET LOCAL app.tenant_id = '${s.tenantId}'`);
    await c.query(
      `SET LOCAL app.user_id = '${s.userId}'`);
    await c.query(
      `SET LOCAL app.actor_kind = 'user'`);
    await c.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, procedure_id, percentage, priority)
       VALUES ($1, gen_random_uuid(), $2, $3, 50.00, 10)`,
      [s.tenantId, s.professionalId, s.procedureId]);
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

let s: SementeAuto;
let actor: Actor;

beforeAll(async () => {
  s = await semearAuto();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('recordPayment — calcula split automaticamente', () => {
  it('cria split quando pagamento e registrado com paidNow=true', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Consulta com split auto',
        amountCents: 30000,
        paymentMethodId: s.paymentMethodId,
        paidNow: true,
        idempotencyKey: `auto-split-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Verificar que o split foi criado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        professional_share_cents: string;
        clinic_share_cents: string;
        status: string;
      }>(
        `SELECT professional_share_cents::text, clinic_share_cents::text, status::text
           FROM fin.split WHERE entry_id = $1`,
        [r.value.entryId]));

    expect(rows).toHaveLength(1);
    // 50% de 30000 = 15000
    expect(rows[0]).toEqual({
      professional_share_cents: '15000',
      clinic_share_cents: '15000',
      status: 'pendente',
    });
  });

  it('nao cria split quando pagamento e pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Consulta pendente',
        amountCents: 20000,
        paymentMethodId: s.paymentMethodId,
        paidNow: false,
        dueDate: '2026-12-01',
        idempotencyKey: `auto-pend-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`,
        [r.value.entryId]));

    expect(Number(rows[0]?.n)).toBe(0);
  });
});
