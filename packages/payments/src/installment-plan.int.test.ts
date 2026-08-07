import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createInstallmentPlan } from './installment-plan';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  categoryId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    paymentMethodId: uuidv7(), categoryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Inst Domain', '55ABC66701DE88')`,
      [s.tenantId, `idom-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade IDom', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin IDom')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'cartao_credito', 'Cartao Inst')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Equipamento', 'despesa')`,
      [s.tenantId, s.categoryId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createInstallmentPlan — domain', () => {
  it('particiona 100000 centavos em 3 parcelas sem perda', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Cadeira odontologica',
        kind: 'despesa',
        totalAmountCents: 100000,
        installments: 3,
        firstDueDate: '2026-10-15',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.planId).toBeDefined();
    expect(result.value.motherEntryId).toBeDefined();
    expect(result.value.installmentEntryIds).toHaveLength(3);

    // Verifica que a soma das parcelas = valor total
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ total: string }>(
        `SELECT sum(amount_cents)::text AS total
           FROM fin.entry
          WHERE installment_plan_id = $1`,
        [result.value.planId]));

    expect(rows[0]?.total).toBe('100000');
  });

  it('particiona valor impar sem perder centavo (allocate do kernel)', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Autoclave usada',
        kind: 'despesa',
        totalAmountCents: 10001,
        installments: 3,
        firstDueDate: '2026-11-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ total: string }>(
        `SELECT sum(amount_cents)::text AS total
           FROM fin.entry
          WHERE installment_plan_id = $1`,
        [result.value.planId]));

    // 10001 / 3 = 3333 + 3334 + 3334 — soma exata
    expect(rows[0]?.total).toBe('10001');
  });

  it('rejeita menos de 2 parcelas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Uma so',
        kind: 'despesa',
        totalAmountCents: 50000,
        installments: 1,
        firstDueDate: '2026-12-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('parcelas_insuficientes');
  });

  it('rejeita valor zero', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Gratis',
        kind: 'despesa',
        totalAmountCents: 0,
        installments: 2,
        firstDueDate: '2026-12-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('valor_invalido');
  });

  it('marca a parcela-mae com status cancelado (substituida pelas filhas)', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createInstallmentPlan(tx, {
        description: 'Mae cancelada',
        kind: 'despesa',
        totalAmountCents: 60000,
        installments: 2,
        firstDueDate: '2026-10-01',
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        paymentMethodId: s.paymentMethodId,
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status::text FROM fin.entry WHERE id = $1`,
        [result.value.motherEntryId]));

    expect(rows[0]?.status).toBe('cancelado');
  });
});
