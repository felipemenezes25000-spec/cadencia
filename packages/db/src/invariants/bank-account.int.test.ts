import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeConta {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  bankAccountCaixaId: string;
  bankAccountBancoId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearConta(): Promise<SementeConta> {
  const s: SementeConta = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(),
    bankAccountCaixaId: uuidv7(), bankAccountBancoId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Conta', '11ABC22301DE44')`,
      [s.tenantId, `ba-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade BA', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario BA')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
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

let s: SementeConta;
let actor: Actor;

beforeAll(async () => {
  s = await semearConta();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, account_type)
       VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'corrente'),
              (app.require_tenant_id(), $2, 'Banco do Brasil', 'poupanca')`,
      [s.bankAccountCaixaId, s.bankAccountBancoId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin.bank_account — RLS e constraints', () => {
  it('insere e le conta bancaria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; account_type: string }>(
        `SELECT name, account_type FROM fin.bank_account WHERE id = $1`,
        [s.bankAccountCaixaId]));
    expect(rows[0]).toEqual({ name: 'Caixa Interno', account_type: 'corrente' });
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, account_type)
           VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'corrente')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('rejeita account_type invalido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, account_type)
           VALUES (app.require_tenant_id(), $1, 'Invalido', 'invalido')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });
});

describe('schema fin.transfer — constraints', () => {
  it('rejeita transferencia para a mesma conta', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Debito teste', 10000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Credito teste', 10000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountCaixaId]);
    });

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.transfer
             (tenant_id, id, from_bank_account_id, to_bank_account_id,
              amount_cents, description, debit_entry_id, credit_entry_id,
              created_by)
           VALUES (app.require_tenant_id(), $1, $2, $2,
                   10000, 'Mesma conta', $3, $4, app.current_user_id())`,
          [uuidv7(), s.bankAccountCaixaId, debitId, creditId])),
    ).rejects.toThrow();
  });

  it('insere transferencia valida entre contas', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();
    const transferId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Transferencia saida', 5000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Transferencia entrada', 5000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountBancoId]);

      await tx.query(
        `INSERT INTO fin.transfer
           (tenant_id, id, from_bank_account_id, to_bank_account_id,
            amount_cents, description, debit_entry_id, credit_entry_id,
            created_by)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 5000, 'Deposito', $4, $5, app.current_user_id())`,
        [transferId, s.bankAccountCaixaId, s.bankAccountBancoId,
         debitId, creditId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; description: string }>(
        `SELECT amount_cents::text, description FROM fin.transfer WHERE id = $1`,
        [transferId]));
    expect(rows[0]).toEqual({ amount_cents: '5000', description: 'Deposito' });
  });
});

describe('fin.entry — bank_account_id e nullable e funcional', () => {
  it('aceita lancamento sem bank_account_id (retrocompativel)', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Sem conta', 3000, $4, 'pendente', $5)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `nobank-${entryId}`]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string | null }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBeNull();
  });

  it('aceita lancamento com bank_account_id', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Com conta', 4000, $4, 'pago', $5, $6, clock_timestamp())`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `withbank-${entryId}`, s.bankAccountCaixaId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBe(s.bankAccountCaixaId);
  });
});
