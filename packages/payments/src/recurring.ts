// packages/payments/src/recurring.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type RecurringFailure =
  | { kind: 'valor_invalido' }
  | { kind: 'frequencia_invalida' }
  | { kind: 'data_fim_anterior_ao_inicio' };

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const VALID_FREQUENCIES: readonly string[] = ['weekly', 'biweekly', 'monthly', 'yearly'];

export interface CreateRecurringTemplateInput {
  readonly description: string;
  readonly kind: 'receita' | 'despesa';
  readonly amountCents: number;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly bankAccountId?: string;
  readonly costCenterId?: string;
  readonly supplierId?: string;
  readonly frequency: RecurrenceFrequency;
  readonly dayOfMonth?: number;
  readonly nextDueDate: string;
  readonly endsAt?: string;
}

export interface RecurringTemplateCreated {
  readonly templateId: string;
}

/**
 * Cria um template de lançamento recorrente. A materialização é feita pelo
 * job materializeRecurringEntries (Task 12), que gera fin.entry a partir
 * de templates com next_due_date <= hoje + 30 dias.
 */
export async function createRecurringTemplate(
  tx: TxClient,
  i: CreateRecurringTemplateInput,
): Promise<Result<RecurringTemplateCreated, RecurringFailure>> {
  if (i.amountCents <= 0 || !Number.isSafeInteger(i.amountCents)) {
    return err({ kind: 'valor_invalido' });
  }
  if (!VALID_FREQUENCIES.includes(i.frequency)) {
    return err({ kind: 'frequencia_invalida' });
  }
  if (i.endsAt !== undefined && i.endsAt < i.nextDueDate) {
    return err({ kind: 'data_fim_anterior_ao_inicio' });
  }

  const templateId = uuidv7();

  await tx.query(
    `INSERT INTO fin.recurring_template
       (tenant_id, id, description, kind, category_id, amount_cents,
        clinic_id, bank_account_id, cost_center_id, supplier_id,
        frequency, day_of_month, next_due_date, active, ends_at, created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3::fin.entry_kind, $4, $5,
             $6, $7, $8, $9,
             $10::fin.recurrence_frequency, $11, $12::date, true, $13::date,
             app.current_user_id())`,
    [templateId, i.description, i.kind, i.categoryId ?? null, i.amountCents,
     i.clinicId, i.bankAccountId ?? null, i.costCenterId ?? null,
     i.supplierId ?? null,
     i.frequency, i.dayOfMonth ?? null, i.nextDueDate, i.endsAt ?? null]);

  await tx.query(
    `SELECT audit.log('RECURRING_CREATE', 'fin', 'recurring_template', $1, 'sucesso',
                      jsonb_build_object('frequency', $2::text,
                                         'amount_cents', $3::bigint), $4)`,
    [templateId, i.frequency, i.amountCents, i.clinicId]);

  return ok({ templateId });
}
