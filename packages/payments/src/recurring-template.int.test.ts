// packages/payments/src/recurring-template.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRecurring {
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

async function semearRecurring(): Promise<SementeRecurring> {
  const s: SementeRecurring = {
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
       VALUES ($1, $2, 'Clinica Recorrente', '33ABC44501DE66')`,
      [s.tenantId, `rec-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rec', '4444444', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Rec')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'MG', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Aluguel', 'despesa')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Rec')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.supplier (tenant_id, id, name, active)
       VALUES ($1, $2, 'Imobiliaria Centro', true)`,
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

let s: SementeRecurring;
let actor: Actor;

beforeAll(async () => {
  s = await semearRecurring();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.recurring_template — templates recorrentes', () => {
  it('insere e le template mensal com RLS', async () => {
    const templateId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.recurring_template
           (tenant_id, id, description, kind, category_id, amount_cents,
            clinic_id, supplier_id, frequency, day_of_month,
            next_due_date, active)
         VALUES (app.require_tenant_id(), $1, 'Aluguel sala 3', 'despesa',
                 $2, 350000, $3, $4,
                 'monthly', 10, '2026-09-10', true)`,
        [templateId, s.categoryId, s.clinicId, s.supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        description: string;
        kind: string;
        frequency: string;
        day_of_month: number;
        amount_cents: string;
        next_due_date: string;
        active: boolean;
      }>(
        `SELECT description, kind::text, frequency::text, day_of_month,
                amount_cents::text, next_due_date::text, active
           FROM fin.recurring_template WHERE id = $1`,
        [templateId]));

    expect(rows[0]).toEqual({
      description: 'Aluguel sala 3',
      kind: 'despesa',
      frequency: 'monthly',
      day_of_month: 10,
      amount_cents: '350000',
      next_due_date: '2026-09-10',
      active: true,
    });
  });

  it('aceita frequencia weekly, biweekly e yearly', async () => {
    for (const freq of ['weekly', 'biweekly', 'yearly'] as const) {
      const id = uuidv7();
      await withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, $2, 'despesa', 10000, $3,
                   $4, '2026-10-01', true)`,
          [id, `Freq ${freq}`, s.clinicId, freq]);
      });

      const { rows } = await withTenantTx(actor, (tx) =>
        tx.query<{ frequency: string }>(
          `SELECT frequency::text FROM fin.recurring_template WHERE id = $1`,
          [id]));
      expect(rows[0]?.frequency).toBe(freq);
    }
  });

  it('rejeita frequencia invalida', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, 'Invalido', 'despesa', 10000, $2,
                   'diario', '2026-10-01', true)`,
          [uuidv7(), s.clinicId]);
      }),
    ).rejects.toThrow();
  });

  it('rejeita amount_cents menor ou igual a zero', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.recurring_template
             (tenant_id, id, description, kind, amount_cents, clinic_id,
              frequency, next_due_date, active)
           VALUES (app.require_tenant_id(), $1, 'Zero', 'despesa', 0, $2,
                   'monthly', '2026-10-01', true)`,
          [uuidv7(), s.clinicId]);
      }),
    ).rejects.toThrow();
  });

  it('template pode referenciar receita (kind=receita)', async () => {
    const id = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.recurring_template
           (tenant_id, id, description, kind, amount_cents, clinic_id,
            frequency, next_due_date, active)
         VALUES (app.require_tenant_id(), $1, 'Mensalidade academia', 'receita',
                 15000, $2, 'monthly', '2026-10-05', true)`,
        [id, s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ kind: string }>(
        `SELECT kind::text FROM fin.recurring_template WHERE id = $1`,
        [id]));
    expect(rows[0]?.kind).toBe('receita');
  });

  it('isolamento de tenant: outro tenant nao ve templates', async () => {
    const otherTenant = uuidv7();
    const otherUser = uuidv7();
    const otherClinic = uuidv7();

    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Rec', '88ABC99901DE77')`,
        [otherTenant, `otr-${otherTenant}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outro Rec', '2222222', 'America/Sao_Paulo')`,
        [otherTenant, otherClinic]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Outro Rec')`,
        [otherUser, `${otherUser}@example.test`]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenant, otherUser, otherClinic]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const otherActor: Actor = {
      kind: 'user', tenantId: otherTenant, userId: otherUser,
      clinicId: otherClinic, requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(`SELECT id::text FROM fin.recurring_template`));

    expect(rows).toHaveLength(0);
  });
});
