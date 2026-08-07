// packages/payments/src/bank-account-cost-center.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeContas {
  tenantId: string;
  clinicId: string;
  userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearContas(): Promise<SementeContas> {
  const s: SementeContas = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Contas', '11ABC22301DE45')`,
      [s.tenantId, `cc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Contas', '1111111', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Contas')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

let s: SementeContas;
let actor: Actor;

beforeAll(async () => {
  s = await semearContas();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('schema fin.bank_account — RLS, unicidade e default', () => {
  const accountId = uuidv7();

  it('insere conta bancaria com RLS ativa', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.bank_account
           (tenant_id, id, name, bank_code, agency, account_number,
            account_type, initial_balance_cents, is_default)
         VALUES (app.require_tenant_id(), $1, 'Bradesco Corrente', '237',
                 '1234', '56789-0', 'corrente', 0, false)`,
        [accountId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; bank_code: string; account_type: string }>(
        `SELECT name, bank_code, account_type::text
           FROM fin.bank_account WHERE id = $1`, [accountId]));
    expect(rows[0]).toEqual({
      name: 'Bradesco Corrente',
      bank_code: '237',
      account_type: 'corrente',
    });
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account
             (tenant_id, id, name, is_default)
           VALUES (app.require_tenant_id(), $1, 'Bradesco Corrente', false)`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('permite no maximo UMA conta default por tenant', async () => {
    // O trigger trg_tenant_default_bank_account ja criou "Caixa Geral" (is_default=true)
    // Tentar inserir outra default deve falhar pelo indice parcial unico
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account
             (tenant_id, id, name, is_default)
           VALUES (app.require_tenant_id(), $1, 'Outra Default', true)`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('insere conta poupanca', async () => {
    const poupId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.bank_account
           (tenant_id, id, name, bank_code, agency, account_number,
            account_type, initial_balance_cents)
         VALUES (app.require_tenant_id(), $1, 'Itau Poupanca', '341',
                 '5678', '12345-6', 'poupanca', 100000)`,
        [poupId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ account_type: string; initial_balance_cents: string }>(
        `SELECT account_type::text, initial_balance_cents::text
           FROM fin.bank_account WHERE id = $1`, [poupId]));
    expect(rows[0]).toEqual({
      account_type: 'poupanca',
      initial_balance_cents: '100000',
    });
  });
});

describe('schema fin.cost_center — RLS e unicidade', () => {
  const centerId = uuidv7();

  it('insere centro de custo com RLS ativa', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.cost_center
           (tenant_id, id, code, name)
         VALUES (app.require_tenant_id(), $1, 'ADM', 'Administrativo')`,
        [centerId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ code: string; name: string }>(
        `SELECT code, name FROM fin.cost_center WHERE id = $1`,
        [centerId]));
    expect(rows[0]).toEqual({ code: 'ADM', name: 'Administrativo' });
  });

  it('rejeita codigo duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.cost_center
             (tenant_id, id, code, name)
           VALUES (app.require_tenant_id(), $1, 'ADM', 'Outro Admin')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.cost_center
             (tenant_id, id, code, name)
           VALUES (app.require_tenant_id(), $1, 'ADM2', 'Administrativo')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('aceita mesmo codigo em tenants diferentes', async () => {
    const outroTenantId = uuidv7();
    const outroUserId = uuidv7();
    const outroClinicId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '99ABC88701DE21')`,
        [outroTenantId, `ot-${outroTenantId}`]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Outra', '9999999', 'America/Sao_Paulo')`,
        [outroTenantId, outroClinicId]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Admin Outro')`,
        [outroUserId, `${outroUserId}@example.test`]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [outroTenantId, outroUserId, outroClinicId]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const outroActor: Actor = {
      kind: 'user', tenantId: outroTenantId, userId: outroUserId,
      clinicId: outroClinicId, requestId: uuidv7(),
    };

    await withTenantTx(outroActor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.cost_center
           (tenant_id, id, code, name)
         VALUES (app.require_tenant_id(), $1, 'ADM', 'Administrativo')`,
        [uuidv7()]);
    });
    // Se chegou aqui sem erro, o mesmo codigo e aceito em outro tenant
  });
});
