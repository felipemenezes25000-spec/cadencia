import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeFinanceiro {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  categoryId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearFinanceiro(): Promise<SementeFinanceiro> {
  const s: SementeFinanceiro = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Financeiro', '12ABC34501DE35')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Fin')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Financeiro', 'completo')`,
      [s.tenantId, s.patientId]);
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

let s: SementeFinanceiro;
let actor: Actor;

beforeAll(async () => {
  s = await semearFinanceiro();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semeia categoria e metodo de pagamento via transacao de negocio
  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES (app.require_tenant_id(), $1, 'Consulta', 'receita')`,
      [s.categoryId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin — categorias e metodos', () => {
  it('insere e le categoria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.category WHERE id = $1`,
        [s.categoryId]));
    expect(rows[0]).toEqual({ name: 'Consulta', kind: 'receita' });
  });

  it('insere e le metodo de pagamento com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.payment_method WHERE id = $1`,
        [s.paymentMethodId]));
    expect(rows[0]).toEqual({ name: 'Dinheiro', kind: 'dinheiro' });
  });

  it('insere lancamento financeiro e recibo', async () => {
    const entryId = uuidv7();
    const receiptId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4, $5,
                 'Consulta particular', 25000, $6, clock_timestamp(), 'pago', $7)`,
        [entryId, s.categoryId, s.patientId, s.professionalId, s.clinicId,
         s.paymentMethodId, `pay-${entryId}`]);

      // Provisiona o contador de recibo
      await tx.query(
        `INSERT INTO fin.receipt_counter (tenant_id, next_value)
         VALUES (app.require_tenant_id(), 1)
         ON CONFLICT (tenant_id) DO NOTHING`);

      // Consome o proximo numero de recibo
      const { rows: counterRows } = await tx.query<{ consumed: string }>(
        `UPDATE fin.receipt_counter
            SET next_value = next_value + 1
          WHERE tenant_id = app.require_tenant_id()
        RETURNING next_value - 1 AS consumed`);
      const receiptNumber = Number(counterRows[0]?.consumed);

      await tx.query(
        `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number)
         VALUES (app.require_tenant_id(), $1, $2, $3)`,
        [receiptId, entryId, receiptNumber]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; status: string; receipt_number: string }>(
        `SELECT e.amount_cents::text AS amount_cents, e.status::text AS status,
                r.receipt_number::text AS receipt_number
           FROM fin.entry e
           JOIN fin.receipt r ON (r.tenant_id, r.entry_id) = (e.tenant_id, e.id)
          WHERE e.id = $1`, [entryId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      status: 'pago',
      receipt_number: '1',
    });
  });

  it('rejeita idempotency_key duplicada', async () => {
    const key = `dup-${uuidv7()}`;
    const e1 = uuidv7();
    const e2 = uuidv7();

    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Duplicata', 10000, $4, 'pendente', $5)`,
        [e1, s.professionalId, s.clinicId, s.paymentMethodId, key]));

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Duplicata 2', 10000, $4, 'pendente', $5)`,
          [e2, s.professionalId, s.clinicId, s.paymentMethodId, key])),
    ).rejects.toThrow();
  });

  it('rejeita amount_cents zero ou negativo', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Invalido', 0, $4, 'pendente', $5)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `zero-${uuidv7()}`])),
    ).rejects.toThrow();
  });
});

describe('schema fin — daily_rollup', () => {
  it('insere e le rollup com sentinela de categoria', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'competencia', 'receita',
                 '00000000-0000-0000-0000-000000000000', 'pago', 25000, 1)`,
        [s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; entries: number; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, entries, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'competencia'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      entries: 1,
      basis: 'competencia',
    });
  });

  it('insere rollup com base caixa (paid_at)', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'caixa', 'receita',
                 $2, 'pago', 25000, 1)`,
        [s.clinicId, s.categoryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'caixa'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({ amount_cents: '25000', basis: 'caixa' });
  });

  it('rejeita basis diferente de competencia ou caixa', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.daily_rollup
             (tenant_id, clinic_id, day, basis, kind, status, amount_cents, entries)
           VALUES (app.require_tenant_id(), $1, '2026-08-02', 'outro', 'receita', 'pago', 100, 1)`,
          [s.clinicId])),
    ).rejects.toThrow();
  });
});
