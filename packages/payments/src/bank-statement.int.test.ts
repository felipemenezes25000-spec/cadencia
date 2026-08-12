import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { Pool } from 'pg';

interface SementeStatement {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
  otherAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearStatement(): Promise<SementeStatement> {
  const s: SementeStatement = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(), otherAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Extrato', '66ABC77801DE99')`,
      [s.tenantId, `st-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Extrato', '6677889', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Ext')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro Ext')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name)
       VALUES ($1, $2, 'Caixa Extrato'),
              ($1, $3, 'Outra Conta')`,
      [s.tenantId, s.bankAccountId, s.otherAccountId]);
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

let s: SementeStatement;
let actor: Actor;

beforeAll(async () => {
  s = await semearStatement();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lançamentos na conta: 3 entries em sequência
  await withTenantTx(actor, async (tx) => {
    // Receita 1 - paga há 3 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta A', 30000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '3 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-1-${uuidv7()}`, s.bankAccountId]);

    // Despesa - paga há 2 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material escritorio', 8000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '2 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-2-${uuidv7()}`, s.bankAccountId]);

    // Receita 2 - paga há 1 dia
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta B', 20000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-3-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getBankStatement — extrato por conta', () => {
  it('retorna linhas ordenadas por data com saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));

    expect(r.lines.length).toBe(3);

    // Primeira linha: +30000 -> saldo = 30000
    expect(r.lines[0]!.amountCents).toBe(30000);
    expect(r.lines[0]!.kind).toBe('receita');
    expect(r.lines[0]!.runningBalanceCents).toBe(30000);

    // Segunda linha: -8000 -> saldo = 22000
    expect(r.lines[1]!.amountCents).toBe(8000);
    expect(r.lines[1]!.kind).toBe('despesa');
    expect(r.lines[1]!.runningBalanceCents).toBe(22000);

    // Terceira linha: +20000 -> saldo = 42000
    expect(r.lines[2]!.amountCents).toBe(20000);
    expect(r.lines[2]!.kind).toBe('receita');
    expect(r.lines[2]!.runningBalanceCents).toBe(42000);
  });

  it('retorna totalBalance igual ao ultimo saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.totalBalanceCents).toBe(42000);
  });

  it('retorna array vazio para conta sem lancamentos no periodo', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.otherAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.lines).toHaveLength(0);
    expect(r.totalBalanceCents).toBe(0);
  });
});
