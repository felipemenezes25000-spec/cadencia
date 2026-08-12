import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type TransferFailure =
  | { kind: 'conta_origem_nao_encontrada' }
  | { kind: 'conta_destino_nao_encontrada' }
  | { kind: 'mesma_conta' };

export interface CreateTransferInput {
  readonly fromBankAccountId: string;
  readonly toBankAccountId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly clinicId: string;
  readonly professionalId: string;
}

export interface TransferCreated {
  readonly transferId: string;
  readonly debitEntryId: string;
  readonly creditEntryId: string;
}

/**
 * Cria transferência entre contas bancárias. Gera DOIS fin.entry vinculados:
 * - Um débito (kind='despesa') na conta de origem
 * - Um crédito (kind='receita') na conta de destino
 *
 * O saldo de cada conta é DERIVADO de SUM(amount_cents) sobre entries da conta,
 * nunca é campo atualizado. Transferência é a única operação que cria entries
 * sem patient_id e sem appointment_id.
 */
export async function createTransfer(
  tx: TxClient,
  i: CreateTransferInput,
): Promise<Result<TransferCreated, TransferFailure>> {
  if (i.fromBankAccountId === i.toBankAccountId) {
    return err({ kind: 'mesma_conta' });
  }

  // Verificar que a conta de origem existe
  const { rows: fromRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.fromBankAccountId]);
  if (fromRows.length === 0) {
    return err({ kind: 'conta_origem_nao_encontrada' });
  }

  // Verificar que a conta de destino existe
  const { rows: toRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.toBankAccountId]);
  if (toRows.length === 0) {
    return err({ kind: 'conta_destino_nao_encontrada' });
  }

  // Resolver método de pagamento 'transferencia_interna' (auto-provisiona)
  const { rows: pmRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method
      WHERE kind = 'dinheiro'::fin.payment_method_kind LIMIT 1`);

  let paymentMethodId: string;
  if (pmRows.length > 0) {
    paymentMethodId = pmRows[0]!.id;
  } else {
    const newPmId = uuidv7();
    await tx.query(
      `INSERT INTO fin.payment_method (id, kind, name)
       VALUES ($1, 'dinheiro'::fin.payment_method_kind, 'Transferencia Interna')`,
      [newPmId]);
    paymentMethodId = newPmId;
  }

  const debitEntryId = uuidv7();
  const creditEntryId = uuidv7();
  const transferId = uuidv7();

  // Entry de débito na conta de origem (kind='despesa')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [debitEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-deb:${transferId}`, i.fromBankAccountId]);

  // Entry de crédito na conta de destino (kind='receita')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [creditEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-cre:${transferId}`, i.toBankAccountId]);

  // Registro da transferência
  await tx.query(
    `INSERT INTO fin.transfer
       (tenant_id, id, from_bank_account_id, to_bank_account_id,
        amount_cents, description, debit_entry_id, credit_entry_id,
        created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3,
             $4, $5, $6, $7, app.current_user_id())`,
    [transferId, i.fromBankAccountId, i.toBankAccountId,
     i.amountCents, i.description, debitEntryId, creditEntryId]);

  // Auditoria
  await tx.query(
    `SELECT audit.log('TRANSFER_CREATE', 'fin', 'transfer', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'from_account', $3::text,
                                         'to_account', $4::text,
                                         'transfer_id', $5::text), $6)`,
    [transferId, i.amountCents, i.fromBankAccountId,
     i.toBankAccountId, transferId, i.clinicId]);

  return ok({ transferId, debitEntryId, creditEntryId });
}
