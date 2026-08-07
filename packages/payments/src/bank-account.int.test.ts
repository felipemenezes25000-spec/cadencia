// packages/payments/src/bank-account.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createBankAccount, updateBankAccount, deactivateBankAccount, listBankAccounts,
} from './bank-account';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
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
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica BA Domain', '44ABC55601DE78')`,
      [s.tenantId, `bad-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade BA', '4444444', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin BA')`,
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

describe('createBankAccount — cria conta bancaria', () => {
  it('cria conta corrente com todos os campos', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, {
        name: 'Banco do Brasil',
        bankCode: '001',
        agency: '1234-5',
        accountNumber: '67890-1',
        accountType: 'corrente',
        initialBalanceCents: 500000,
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Banco do Brasil');
    expect(r.value.bankCode).toBe('001');
    expect(r.value.accountType).toBe('corrente');
    expect(r.value.initialBalanceCents).toBe(500000);
    expect(r.value.active).toBe(true);
  });

  it('cria conta minima sem dados bancarios', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Caixa Avulsa' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bankCode).toBeNull();
    expect(r.value.accountType).toBeNull();
  });
});

describe('updateBankAccount — atualiza conta bancaria', () => {
  let accountId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Para Atualizar', bankCode: '033' }));
    if (r.ok) accountId = r.value.id;
  });

  it('atualiza nome e banco', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateBankAccount(tx, { id: accountId, name: 'Santander', bankCode: '033' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Santander');
  });

  it('retorna erro para conta inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateBankAccount(tx, { id: uuidv7(), name: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_nao_encontrada');
  });
});

describe('deactivateBankAccount — desativa conta', () => {
  let accountId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createBankAccount(tx, { name: 'Para Desativar' }));
    if (r.ok) accountId = r.value.id;
  });

  it('desativa conta nao-default', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, accountId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar conta ja desativada', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, accountId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativada');
  });

  it('recusa desativar a conta default (Caixa Geral)', async () => {
    // A Caixa Geral foi provisionada automaticamente pelo trigger
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.bank_account
          WHERE is_default = true LIMIT 1`));
    const defaultId = rows[0]?.id;
    expect(defaultId).toBeDefined();

    const r = await withTenantTx(actor, (tx) =>
      deactivateBankAccount(tx, defaultId!));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_default_nao_pode_desativar');
  });
});

describe('listBankAccounts — lista contas do tenant', () => {
  it('lista somente ativas por padrao, com default primeiro', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listBankAccounts(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    // Caixa Geral (default) sempre aparece primeiro
    expect(lista[0]?.isDefault).toBe(true);
    // Todas ativas
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });

  it('lista todas incluindo desativadas', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listBankAccounts(tx, false));
    const inativos = lista.filter((a) => !a.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
