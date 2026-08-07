import { err, ok, uuidv7, allocate, brl, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type InstallmentFailure =
  | { kind: 'parcelas_insuficientes' }
  | { kind: 'valor_invalido' }
  | { kind: 'metodo_nao_encontrado' };

export interface CreateInstallmentPlanInput {
  readonly description: string;
  readonly kind: 'receita' | 'despesa';
  readonly totalAmountCents: number;
  readonly installments: number;
  readonly firstDueDate: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly paymentMethodId: string;
  readonly categoryId?: string;
  readonly supplierId?: string;
}

export interface InstallmentPlanCreated {
  readonly planId: string;
  readonly motherEntryId: string;
  readonly installmentEntryIds: readonly string[];
}

/**
 * Cria um plano de parcelamento: entry-mae (cancelada, referencia), N entries
 * filhas com valores rateados via allocate() do kernel (sem perder centavo).
 * Datas de vencimento incrementam mensalmente a partir de firstDueDate.
 */
export async function createInstallmentPlan(
  tx: TxClient,
  i: CreateInstallmentPlanInput,
): Promise<Result<InstallmentPlanCreated, InstallmentFailure>> {
  if (i.installments < 2) return err({ kind: 'parcelas_insuficientes' });
  if (i.totalAmountCents <= 0 || !Number.isSafeInteger(i.totalAmountCents)) {
    return err({ kind: 'valor_invalido' });
  }

  // Valida metodo de pagamento
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  // Rateia o valor total sem perder centavo
  const ratios = Array.from({ length: i.installments }, () => 1);
  const shares = allocate(brl(i.totalAmountCents), ratios);

  // Cria a entry-mae (referencia, cancelada — substituida pelas parcelas)
  const motherEntryId = uuidv7();
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, professional_id, clinic_id,
        description, amount_cents, payment_method_id, status,
        due_date, idempotency_key, supplier_id, created_by)
     VALUES (app.require_tenant_id(), $1, $2::fin.entry_kind, $3, $4, $5,
             $6, $7, $8, 'cancelado',
             $9::date, $10, $11, app.current_user_id())`,
    [motherEntryId, i.kind, i.categoryId ?? null, i.professionalId, i.clinicId,
     i.description, i.totalAmountCents, i.paymentMethodId,
     i.firstDueDate, `mother-${motherEntryId}`, i.supplierId ?? null]);

  // Cria o plano
  const planId = uuidv7();
  await tx.query(
    `INSERT INTO fin.installment_plan
       (tenant_id, id, mother_entry_id, total_installments, generated_installments)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
    [planId, motherEntryId, i.installments, i.installments]);

  // Cria as parcelas filhas
  const installmentEntryIds: string[] = [];
  const baseDate = new Date(i.firstDueDate + 'T12:00:00Z');

  for (let idx = 0; idx < i.installments; idx++) {
    const entryId = uuidv7();
    installmentEntryIds.push(entryId);

    // Calcula a data de vencimento (incrementa mes a mes a partir da base)
    const dueDate = new Date(baseDate);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + idx);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const share = shares[idx]!;
    const label = `${i.description} (${idx + 1}/${i.installments})`;

    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, category_id, professional_id, clinic_id,
          description, amount_cents, payment_method_id, status,
          due_date, idempotency_key, supplier_id, installment_plan_id,
          created_by)
       VALUES (app.require_tenant_id(), $1, $2::fin.entry_kind, $3, $4, $5,
               $6, $7, $8, 'pendente',
               $9::date, $10, $11, $12, app.current_user_id())`,
      [entryId, i.kind, i.categoryId ?? null, i.professionalId, i.clinicId,
       label, share.cents, i.paymentMethodId,
       dueDateStr, `inst-${entryId}`, i.supplierId ?? null, planId]);
  }

  // Audit log
  await tx.query(
    `SELECT audit.log('INSTALLMENT_CREATE', 'fin', 'installment_plan', $1, 'sucesso',
                      jsonb_build_object('total_installments', $2::int,
                                         'amount_cents', $3::bigint), $4)`,
    [planId, i.installments, i.totalAmountCents, i.clinicId]);

  return ok({ planId, motherEntryId, installmentEntryIds });
}
