// packages/payments/src/recurring.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecurringTemplate } from './recurring';

interface Semente {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  categoryId: string;
  paymentMethodId: string;
  supplierId: string;
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
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
    supplierId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica RecDom', '44ABC55601DE77')`,
      [s.tenantId, `rdom-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade RDom', '3333333', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin RDom')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111000', 'BA', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel Dom', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix RDom')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.supplier (tenant_id, id, name, active)
       VALUES ($1, $2, 'Imobiliaria RDom', true)`,
      [s.tenantId, s.supplierId]);
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

describe('createRecurringTemplate — domain', () => {
  it('cria template mensal de despesa', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Aluguel sala 5',
        kind: 'despesa',
        amountCents: 500000,
        clinicId: s.clinicId,
        categoryId: s.categoryId,
        supplierId: s.supplierId,
        frequency: 'monthly',
        dayOfMonth: 10,
        nextDueDate: '2026-10-10',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.templateId).toBeDefined();

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ description: string; frequency: string; active: boolean }>(
        `SELECT description, frequency::text, active
           FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]).toEqual({
      description: 'Aluguel sala 5',
      frequency: 'monthly',
      active: true,
    });
  });

  it('cria template semanal de receita', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Aula de pilates',
        kind: 'receita',
        amountCents: 15000,
        clinicId: s.clinicId,
        frequency: 'weekly',
        nextDueDate: '2026-10-07',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ kind: string; frequency: string }>(
        `SELECT kind::text, frequency::text
           FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]).toEqual({ kind: 'receita', frequency: 'weekly' });
  });

  it('rejeita amount_cents zero', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Gratis',
        kind: 'despesa',
        amountCents: 0,
        clinicId: s.clinicId,
        frequency: 'monthly',
        nextDueDate: '2026-10-01',
      }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('valor_invalido');
  });

  it('aceita ends_at e cria template com data de fim', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecurringTemplate(tx, {
        description: 'Contrato temporario',
        kind: 'despesa',
        amountCents: 200000,
        clinicId: s.clinicId,
        frequency: 'monthly',
        dayOfMonth: 1,
        nextDueDate: '2026-10-01',
        endsAt: '2027-03-01',
      }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ ends_at: string }>(
        `SELECT ends_at::text FROM fin.recurring_template WHERE id = $1`,
        [result.value.templateId]));

    expect(rows[0]?.ends_at).toBe('2027-03-01');
  });
});
