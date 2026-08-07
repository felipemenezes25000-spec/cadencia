import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type PaymentFailure =
  | { kind: 'lancamento_nao_encontrado' }
  | { kind: 'metodo_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'ja_cancelado' }
  | { kind: 'ja_estornado' }
  | { kind: 'nao_pode_estornar'; status: string }
  | { kind: 'nao_pode_cancelar'; status: string };

export interface RecordPaymentInput {
  readonly patientId?: string;
  readonly appointmentId?: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paymentMethodId: string;
  readonly paidNow: boolean;
  readonly dueDate?: string;
  readonly externalRef?: string;
  readonly idempotencyKey: string;
  readonly bankAccountId?: string;
  readonly costCenterId?: string;
}

export interface RecordedPayment {
  readonly entryId: string;
  readonly receiptId: string | null;
  readonly receiptNumber: number | null;
  readonly status: string;
}

/**
 * Registra pagamento no atendimento. Se paidNow=true, marca como pago e gera
 * recibo automaticamente. O recibo usa numero sequencial por tenant via
 * fin.receipt_counter. A geracao de PDF do recibo e injetada em L3 (via
 * callback), NAO importa documents diretamente — mesmo padrao de exportRecord.
 */
export async function recordPayment(
  tx: TxClient,
  i: RecordPaymentInput,
  generateReceiptPdf?: (entryId: string, receiptNumber: number) => Promise<string | null>,
): Promise<Result<RecordedPayment, PaymentFailure>> {
  // Valida que o metodo de pagamento existe
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  const entryId = uuidv7();
  const status = i.paidNow ? 'pago' : 'pendente';

  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, appointment_id,
        professional_id, clinic_id, description, amount_cents,
        payment_method_id, paid_at, due_date, status, external_ref,
        idempotency_key, created_by, bank_account_id, cost_center_id)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
             $5, $6, $7, $8, $9,
             CASE WHEN $10::boolean THEN clock_timestamp() ELSE NULL END,
             $11::date, $12::fin.entry_status, $13, $14, app.current_user_id(),
             $15, $16)`,
    [entryId, i.categoryId ?? null, i.patientId ?? null, i.appointmentId ?? null,
     i.professionalId, i.clinicId, i.description, i.amountCents,
     i.paymentMethodId, i.paidNow, i.dueDate ?? null, status,
     i.externalRef ?? null, i.idempotencyKey,
     i.bankAccountId ?? null, i.costCenterId ?? null]);

  await tx.query(
    `SELECT audit.log('PAYMENT_RECORD', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'payment_method', $3::text,
                                         'status', $4::text), $5)`,
    [entryId, i.amountCents, 'receita', status, i.clinicId]);

  let receiptId: string | null = null;
  let receiptNumber: number | null = null;

  if (i.paidNow) {
    // Auto-provisiona e consome o proximo numero de recibo
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = fin.receipt_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    receiptNumber = Number(counterRows[0]?.consumed);

    receiptId = uuidv7();
    let pdfStorageKey: string | null = null;
    if (generateReceiptPdf) {
      pdfStorageKey = await generateReceiptPdf(entryId, receiptNumber);
    }

    await tx.query(
      `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number, pdf_storage_key)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
      [receiptId, entryId, receiptNumber, pdfStorageKey]);

    await tx.query(
      `SELECT audit.log('RECEIPT_ISSUE', 'fin', 'receipt', $1, 'sucesso',
                        jsonb_build_object('receipt_number', $2::bigint,
                                           'amount_cents', $3::bigint), $4)`,
      [receiptId, receiptNumber, i.amountCents, i.clinicId]);

    // Calcular split automaticamente para receitas pagas
    await tx.query(
      `SELECT fin.calculate_splits(app.require_tenant_id(), $1)`,
      [entryId]);
  }

  return ok({ entryId, receiptId, receiptNumber, status });
}

export interface CancelPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function cancelPayment(
  tx: TxClient,
  i: CancelPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status !== 'pendente') {
    return err({ kind: 'nao_pode_cancelar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'cancelado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_CANCEL', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'cancelado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'cancelado' });
}

export interface RefundPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function refundPayment(
  tx: TxClient,
  i: RefundPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status !== 'pago') {
    return err({ kind: 'nao_pode_estornar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'estornado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'estornado' });
}
