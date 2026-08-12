// packages/payments/src/entry-bank-cost.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, type UuidV7 } from '@cadencia/kernel';

interface SementeEntryBankCost {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
  costCenterId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearEntryBankCost(): Promise<SementeEntryBankCost> {
  const s: SementeEntryBankCost = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(), costCenterId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Entry BC', '55ABC66701DE89')`,
      [s.tenantId, `ebc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Entry BC', '5555555', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Admin Entry BC')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777777', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro BC')`,
      [s.tenantId, s.paymentMethodId]);
    const { rows: autoBank } = await c.query<{ id: string }>(
      `SELECT id::text FROM fin.bank_account
        WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
      [s.tenantId]);
    s.bankAccountId = autoBank[0]!.id;
    await c.query(
      `INSERT INTO fin.cost_center (tenant_id, id, code, name)
       VALUES ($1, $2, 'CLIN', 'Clinico')`,
      [s.tenantId, s.costCenterId]);
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

let s: SementeEntryBankCost;
let actor: Actor;

beforeAll(async () => {
  s = await semearEntryBankCost();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.entry — colunas bank_account_id e cost_center_id', () => {
  it('insere lancamento COM conta e centro', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, cost_center_id)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Com conta e centro', 30000, $4, 'pendente', $5, $6, $7)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `bc-${entryId}`, s.bankAccountId, s.costCenterId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string; cost_center_id: string }>(
        `SELECT bank_account_id::text, cost_center_id::text
           FROM fin.entry WHERE id = $1`, [entryId]));
    expect(rows[0]).toEqual({
      bank_account_id: s.bankAccountId,
      cost_center_id: s.costCenterId,
    });
  });

  it('insere lancamento SEM conta e centro (retrocompatibilidade Fase 2)', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Sem conta e centro', 20000, $4, 'pendente', $5)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `nobc-${entryId}`]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string | null; cost_center_id: string | null }>(
        `SELECT bank_account_id::text, cost_center_id::text
           FROM fin.entry WHERE id = $1`, [entryId]));
    expect(rows[0]?.bank_account_id).toBeNull();
    expect(rows[0]?.cost_center_id).toBeNull();
  });

  it('rejeita bank_account_id de outro tenant (FK composta)', async () => {
    const outroTenantId = uuidv7();
    let outroAccountId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant BC', '77ABC88901DE32')`,
        [outroTenantId, `ot2-${outroTenantId}`]);
      // A conta padrão do tenant JÁ EXISTE: `trg_tenant_default_bank_account`
      // provisiona uma no INSERT de app.tenant. Inserir outra com is_default
      // estoura `ux_bank_account_default` (uma padrão por tenant) — e o erro
      // aparecia como se o teste do FK composto estivesse quebrado, quando o
      // produto estava certo e o cenário é que era impossível de montar.
      const { rows: alheia } = await c.query<{ id: UuidV7 }>(
        `SELECT id::text FROM fin.bank_account
          WHERE tenant_id = $1 AND is_default LIMIT 1`,
        [outroTenantId]);
      outroAccountId = alheia[0]!.id;
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key,
              bank_account_id)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'FK cruzada', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `fk-cross-${uuidv7()}`, outroAccountId])),
    ).rejects.toThrow();
  });

  it('rejeita cost_center_id inexistente (FK composta)', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key,
              cost_center_id)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Centro fantasma', 10000, $4, 'pendente', $5, $6)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `fk-ghost-${uuidv7()}`, uuidv7()])),
    ).rejects.toThrow();
  });
});
