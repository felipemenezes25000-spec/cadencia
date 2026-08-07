// packages/payments/src/bank-account.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type BankAccountFailure =
  | { kind: 'conta_nao_encontrada' }
  | { kind: 'nome_duplicado' }
  | { kind: 'ja_desativada' }
  | { kind: 'conta_default_nao_pode_desativar' };

export interface CreateBankAccountInput {
  readonly name: string;
  readonly bankCode?: string;
  readonly agency?: string;
  readonly accountNumber?: string;
  readonly accountType?: 'corrente' | 'poupanca';
  readonly initialBalanceCents?: number;
  readonly isDefault?: boolean;
}

export interface BankAccountRow {
  readonly id: string;
  readonly name: string;
  readonly bankCode: string | null;
  readonly agency: string | null;
  readonly accountNumber: string | null;
  readonly accountType: string | null;
  readonly initialBalanceCents: number;
  readonly isDefault: boolean;
  readonly active: boolean;
}

export async function createBankAccount(
  tx: TxClient,
  i: CreateBankAccountInput,
): Promise<Result<BankAccountRow, BankAccountFailure>> {
  const id = uuidv7();
  const isDefault = i.isDefault ?? false;

  try {
    await tx.query(
      `INSERT INTO fin.bank_account
         (tenant_id, id, name, bank_code, agency, account_number,
          account_type, initial_balance_cents, is_default)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5,
               $6::fin.bank_account_type, $7, $8)`,
      [id, i.name, i.bankCode ?? null, i.agency ?? null,
       i.accountNumber ?? null, i.accountType ?? null,
       i.initialBalanceCents ?? 0, isDefault]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('ux_bank_account_default') || msg.includes('duplicate key')) {
      if (msg.includes('bank_account_name') || msg.includes('tenant_id, name')) {
        return err({ kind: 'nome_duplicado' });
      }
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({
    id, name: i.name,
    bankCode: i.bankCode ?? null,
    agency: i.agency ?? null,
    accountNumber: i.accountNumber ?? null,
    accountType: i.accountType ?? null,
    initialBalanceCents: i.initialBalanceCents ?? 0,
    isDefault, active: true,
  });
}

export interface UpdateBankAccountInput {
  readonly id: string;
  readonly name?: string;
  readonly bankCode?: string | null;
  readonly agency?: string | null;
  readonly accountNumber?: string | null;
  readonly accountType?: 'corrente' | 'poupanca' | null;
}

export async function updateBankAccount(
  tx: TxClient,
  i: UpdateBankAccountInput,
): Promise<Result<BankAccountRow, BankAccountFailure>> {
  const { rows } = await tx.query<{
    id: string; name: string; bank_code: string | null;
    agency: string | null; account_number: string | null;
    account_type: string | null; initial_balance_cents: string;
    is_default: boolean; active: boolean;
  }>(
    `SELECT id::text, name, bank_code, agency, account_number,
            account_type::text, initial_balance_cents::text,
            is_default, active
       FROM fin.bank_account WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'conta_nao_encontrada' });

  const name = i.name ?? existing.name;
  const bankCode = i.bankCode !== undefined ? i.bankCode : existing.bank_code;
  const agency = i.agency !== undefined ? i.agency : existing.agency;
  const accountNumber = i.accountNumber !== undefined ? i.accountNumber : existing.account_number;
  const accountType = i.accountType !== undefined ? i.accountType : existing.account_type;

  try {
    await tx.query(
      `UPDATE fin.bank_account
          SET name = $2, bank_code = $3, agency = $4,
              account_number = $5, account_type = $6::fin.bank_account_type
        WHERE id = $1`,
      [i.id, name, bankCode, agency, accountNumber, accountType]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({
    id: existing.id, name,
    bankCode, agency, accountNumber, accountType,
    initialBalanceCents: Number(existing.initial_balance_cents),
    isDefault: existing.is_default,
    active: existing.active,
  });
}

export async function deactivateBankAccount(
  tx: TxClient,
  accountId: string,
): Promise<Result<{ id: string }, BankAccountFailure>> {
  const { rows } = await tx.query<{
    is_default: boolean; active: boolean;
  }>(
    `SELECT is_default, active FROM fin.bank_account WHERE id = $1`,
    [accountId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'conta_nao_encontrada' });
  if (!existing.active) return err({ kind: 'ja_desativada' });
  if (existing.is_default) return err({ kind: 'conta_default_nao_pode_desativar' });

  await tx.query(
    `UPDATE fin.bank_account SET active = false WHERE id = $1`,
    [accountId]);

  return ok({ id: accountId });
}

export async function listBankAccounts(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<BankAccountRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; name: string; bank_code: string | null;
    agency: string | null; account_number: string | null;
    account_type: string | null; initial_balance_cents: string;
    is_default: boolean; active: boolean;
  }>(
    `SELECT id::text, name, bank_code, agency, account_number,
            account_type::text, initial_balance_cents::text,
            is_default, active
       FROM fin.bank_account
      WHERE 1=1 ${whereActive}
      ORDER BY is_default DESC, name`);
  return rows.map((r) => ({
    id: r.id, name: r.name,
    bankCode: r.bank_code,
    agency: r.agency,
    accountNumber: r.account_number,
    accountType: r.account_type,
    initialBalanceCents: Number(r.initial_balance_cents),
    isDefault: r.is_default,
    active: r.active,
  }));
}
