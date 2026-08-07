// packages/payments/src/supplier.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeSupplier {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearSupplier(): Promise<SementeSupplier> {
  const s: SementeSupplier = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Fornecedor', '99ABC88701DE12')`,
      [s.tenantId, `sup-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Sup', '9876543', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Sup')`,
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

let s: SementeSupplier;
let actor: Actor;

beforeAll(async () => {
  s = await semearSupplier();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.supplier — CRUD com RLS', () => {
  it('insere e le fornecedor com RLS ativa', async () => {
    const supplierId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier
           (tenant_id, id, name, cpf_cnpj, contact, active)
         VALUES (app.require_tenant_id(), $1, 'Dental Brasil', '12ABC34501DE35', 'contato@dental.br', true)`,
        [supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; cpf_cnpj: string; active: boolean }>(
        `SELECT name, cpf_cnpj, active FROM fin.supplier WHERE id = $1`,
        [supplierId]));

    expect(rows[0]).toEqual({
      name: 'Dental Brasil',
      cpf_cnpj: '12ABC34501DE35',
      active: true,
    });
  });

  it('isolamento de tenant: outro tenant nao ve o fornecedor', async () => {
    const otherTenant = uuidv7();
    const otherUser = uuidv7();
    const otherClinic = uuidv7();

    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '77ABC66501DE99')`,
        [otherTenant, `ot-${otherTenant}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outro', '1111111', 'America/Sao_Paulo')`,
        [otherTenant, otherClinic]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Outro User')`,
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
      tx.query<{ id: string }>(`SELECT id::text FROM fin.supplier`));

    expect(rows).toHaveLength(0);
  });

  it('nome do fornecedor e COLLATE pt-BR-x-icu', async () => {
    const id1 = uuidv7();
    const id2 = uuidv7();
    const id3 = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, 'Acores', true),
                (app.require_tenant_id(), $2, 'Abacate', true),
                (app.require_tenant_id(), $3, 'Acai', true)`,
        [id1, id2, id3]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string }>(
        `SELECT name FROM fin.supplier
          WHERE id IN ($1, $2, $3)
          ORDER BY name`,
        [id1, id2, id3]));

    expect(rows.map((r) => r.name)).toEqual(['Abacate', 'Acai', 'Acores']);
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    const nameUnique = `DuplicateTest-${uuidv7()}`;
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, $2, true)`,
        [uuidv7(), nameUnique]);
    });

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.supplier (tenant_id, id, name, active)
           VALUES (app.require_tenant_id(), $1, $2, true)`,
          [uuidv7(), nameUnique]);
      }),
    ).rejects.toThrow();
  });
});

describe('fin.entry.supplier_id — FK para fornecedor', () => {
  it('vincula lancamento de despesa a fornecedor', async () => {
    const supplierId = uuidv7();
    const entryId = uuidv7();
    const paymentMethodId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.supplier (tenant_id, id, name, active)
         VALUES (app.require_tenant_id(), $1, 'Fornecedor Vinculado', true)`,
        [supplierId]);
      await tx.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES (app.require_tenant_id(), $1, 'pix', 'Pix Sup')`,
        [paymentMethodId]);
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key, supplier_id)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Material odontologico', 50000, $4, 'pendente', $5, $6)`,
        [entryId, s.professionalId, s.clinicId, paymentMethodId,
         `sup-${entryId}`, supplierId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ supplier_id: string; kind: string }>(
        `SELECT supplier_id::text, kind::text FROM fin.entry WHERE id = $1`,
        [entryId]));

    expect(rows[0]).toEqual({ supplier_id: supplierId, kind: 'despesa' });
  });

  it('rejeita supplier_id inexistente (FK composta)', async () => {
    const paymentMethodId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro Sup FK')`,
        [paymentMethodId]);
    });

    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key, supplier_id)
           VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                   'FK invalida', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, paymentMethodId,
           `fk-bad-${uuidv7()}`, uuidv7()]);
      }),
    ).rejects.toThrow();
  });
});
