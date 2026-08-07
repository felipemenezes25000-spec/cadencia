// packages/payments/src/split-schema.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRepasse {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  categoryId: string;
  paymentMethodId: string;
  procedureId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRepasse(): Promise<SementeRepasse> {
  const s: SementeRepasse = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Repasse', '12ABC34501DE35')`,
      [s.tenantId, `r-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Repasse', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Repasse')`,
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
       VALUES ($1, $2, 'Paciente Repasse', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
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

let s: SementeRepasse;
let actor: Actor;

beforeAll(async () => {
  s = await semearRepasse();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('schema fin — split_rule', () => {
  it('insere regra de repasse percentual com RLS ativa', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, NULL,
                 50.00, NULL, 10)`,
        [ruleId, s.professionalId, s.procedureId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ percentage: string; priority: number }>(
        `SELECT percentage::text, priority FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ percentage: '50.00', priority: 10 });
  });

  it('insere regra default (sem procedure, sem convention)', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, NULL, NULL,
                 40.00, NULL, 1)`,
        [ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ procedure_id: string | null; convention_name: string | null }>(
        `SELECT procedure_id::text, convention_name
           FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ procedure_id: null, convention_name: null });
  });

  it('insere regra com valor fixo por procedimento', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, fixed_amount_cents, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, 'FixedTest',
                 NULL, 15000, 20)`,
        [ruleId, s.professionalId, s.procedureId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ fixed_amount_cents: string; percentage: string | null }>(
        `SELECT fixed_amount_cents::text, percentage::text
           FROM fin.split_rule WHERE id = $1`,
        [ruleId]));
    expect(rows[0]).toEqual({ fixed_amount_cents: '15000', percentage: null });
  });

  it('rejeita percentage fora de 0-100', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, 101.00, 1)`,
          [uuidv7(), s.professionalId])),
    ).rejects.toThrow();
  });

  it('rejeita regra sem percentage nem fixed_amount_cents', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, percentage, fixed_amount_cents, priority)
           VALUES (app.require_tenant_id(), $1, $2, NULL, NULL, 1)`,
          [uuidv7(), s.professionalId])),
    ).rejects.toThrow();
  });

  it('impede regra duplicada (professional + procedure + convention)', async () => {
    const r1 = uuidv7();
    const r2 = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, procedure_id, convention_name,
            percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, $3, 'Unimed',
                 60.00, 5)`,
        [r1, s.professionalId, s.procedureId]);
    });
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, procedure_id, convention_name,
              percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, $3, 'Unimed',
                   70.00, 6)`,
          [r2, s.professionalId, s.procedureId])),
    ).rejects.toThrow();
  });
});

describe('schema fin — split', () => {
  it('insere split vinculado a entry e split_rule', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();
    const splitId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta repasse', 30000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `split-entry-${entryId}`]);

      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, convention_name, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 'SplitTest', 50.00, 1)`,
        [ruleId, s.professionalId]);

      await tx.query(
        `INSERT INTO fin.split
           (tenant_id, id, entry_id, split_rule_id, professional_id,
            clinic_share_cents, professional_share_cents, status)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                 15000, 15000, 'pendente')`,
        [splitId, entryId, ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        clinic_share_cents: string; professional_share_cents: string; status: string;
      }>(
        `SELECT clinic_share_cents::text, professional_share_cents::text, status::text
           FROM fin.split WHERE id = $1`,
        [splitId]));
    expect(rows[0]).toEqual({
      clinic_share_cents: '15000',
      professional_share_cents: '15000',
      status: 'pendente',
    });
  });

  it('rejeita split com shares que nao somam o valor do entry', async () => {
    const entryId = uuidv7();
    const ruleId = uuidv7();
    const splitId = uuidv7();

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id,
              description, amount_cents, payment_method_id, paid_at, status,
              idempotency_key, created_by)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Consulta split errado', 30000, $4, clock_timestamp(), 'pago',
                   $5, app.current_user_id())`,
          [entryId, s.professionalId, s.clinicId,
           s.paymentMethodId, `split-bad-${entryId}`]);

        await tx.query(
          `INSERT INTO fin.split_rule
             (tenant_id, id, professional_id, convention_name, percentage, priority)
           VALUES (app.require_tenant_id(), $1, $2, 'SplitTestBad', 50.00, 99)`,
          [ruleId, s.professionalId]);

        await tx.query(
          `INSERT INTO fin.split
             (tenant_id, id, entry_id, split_rule_id, professional_id,
              clinic_share_cents, professional_share_cents, status)
           VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                   10000, 10000, 'pendente')`,
          [splitId, entryId, ruleId, s.professionalId]);
      }),
    ).rejects.toThrow();
  });
});
