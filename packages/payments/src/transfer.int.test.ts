import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createTransfer, type CreateTransferInput } from './transfer';
import { Pool } from 'pg';

interface SementeTransfer {
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

async function semearTransfer(): Promise<SementeTransfer> {
  const s: SementeTransfer = {
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
       VALUES ($1, $2, 'Clinica Transfer', '44ABC55601DE77')`,
      [s.tenantId, `tf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade TF', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario TF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name)
       VALUES ($1, $2, 'Caixa TF'),
              ($1, $3, 'Banco TF')`,
      [s.tenantId, s.bankAccountCaixaId, s.bankAccountBancoId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro TF')`,
      [s.tenantId, s.paymentMethodId]);
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

let s: SementeTransfer;
let actor: Actor;

beforeAll(async () => {
  s = await semearTransfer();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('createTransfer — transferencia entre contas', () => {
  it('cria transferencia e gera dois entries vinculados', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 15000,
      description: 'Deposito bancario',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.transferId).toBeDefined();
    expect(r.value.debitEntryId).toBeDefined();
    expect(r.value.creditEntryId).toBeDefined();

    // Verificar que os dois entries existem
    const { rows: entries } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string; kind: string; bank_account_id: string; amount_cents: string }>(
        `SELECT id, kind::text, bank_account_id::text, amount_cents::text
           FROM fin.entry
          WHERE id IN ($1, $2) ORDER BY kind`,
        [r.value.debitEntryId, r.value.creditEntryId]));

    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.kind === 'despesa');
    const credit = entries.find((e) => e.kind === 'receita');

    expect(debit).toBeDefined();
    expect(debit!.bank_account_id).toBe(s.bankAccountCaixaId);
    expect(debit!.amount_cents).toBe('15000');

    expect(credit).toBeDefined();
    expect(credit!.bank_account_id).toBe(s.bankAccountBancoId);
    expect(credit!.amount_cents).toBe('15000');

    // Verificar que o transfer existe
    const { rows: transfers } = await withTenantTx(actor, (tx) =>
      tx.query<{ from_bank_account_id: string; to_bank_account_id: string }>(
        `SELECT from_bank_account_id::text, to_bank_account_id::text
           FROM fin.transfer WHERE id = $1`,
        [r.value.transferId]));
    expect(transfers[0]?.from_bank_account_id).toBe(s.bankAccountCaixaId);
    expect(transfers[0]?.to_bank_account_id).toBe(s.bankAccountBancoId);
  });

  it('rejeita conta de origem inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: uuidv7(),
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 5000,
      description: 'Conta fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_origem_nao_encontrada');
  });

  it('rejeita conta de destino inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: uuidv7(),
      amountCents: 5000,
      description: 'Conta destino fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_destino_nao_encontrada');
  });

  it('rejeita transferencia para a mesma conta', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountCaixaId,
      amountCents: 5000,
      description: 'Mesma conta',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('mesma_conta');
  });

  it('grava evento de auditoria TRANSFER_CREATE', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 8000,
      description: 'Auditoria transferencia',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'TRANSFER_CREATE' AND entity_id = $1`,
        [r.value.transferId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
