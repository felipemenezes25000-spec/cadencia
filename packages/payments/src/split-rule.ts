// packages/payments/src/split-rule.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// createSplitRule
// ---------------------------------------------------------------------------

export type SplitRuleFailure =
  | { kind: 'percentual_invalido' }
  | { kind: 'valor_ausente' }
  | { kind: 'profissional_nao_encontrado' }
  | { kind: 'regra_duplicada' };

export interface CreateSplitRuleInput {
  readonly professionalId: string;
  readonly procedureId?: string;
  readonly conventionName?: string;
  readonly percentage?: number;
  readonly fixedAmountCents?: number;
  readonly priority: number;
}

export interface SplitRuleCreated {
  readonly ruleId: string;
}

export async function createSplitRule(
  tx: TxClient,
  i: CreateSplitRuleInput,
): Promise<Result<SplitRuleCreated, SplitRuleFailure>> {
  // Validação: pelo menos um dos dois deve estar presente
  if (i.percentage === undefined && i.fixedAmountCents === undefined) {
    return err({ kind: 'valor_ausente' });
  }
  if (i.percentage !== undefined && (i.percentage < 0 || i.percentage > 100)) {
    return err({ kind: 'percentual_invalido' });
  }

  // Verificar que o profissional existe
  const { rows: profRows } = await tx.query<{ id: string }>(
    `SELECT id FROM app.professional WHERE id = $1`,
    [i.professionalId]);
  if (profRows.length === 0) {
    return err({ kind: 'profissional_nao_encontrado' });
  }

  const ruleId = uuidv7();

  try {
    await tx.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, procedure_id, convention_name,
          percentage, fixed_amount_cents, priority)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5, $6, $7)`,
      [ruleId, i.professionalId, i.procedureId ?? null,
       i.conventionName ?? null,
       i.percentage ?? null, i.fixedAmountCents ?? null,
       i.priority]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('ux_split_rule_combo')) {
      return err({ kind: 'regra_duplicada' });
    }
    throw e;
  }

  await tx.query(
    `SELECT audit.log('SPLIT_RULE_CREATE', 'fin', 'split_rule', $1, 'sucesso',
                      jsonb_build_object('professional_id', $2::text,
                                         'percentage', $3::text,
                                         'priority', $4::int), $5)`,
    [ruleId, i.professionalId,
     i.percentage !== undefined ? String(i.percentage) : 'fixo',
     i.priority, null]);

  return ok({ ruleId });
}

// ---------------------------------------------------------------------------
// calculateSplits
// ---------------------------------------------------------------------------

export type CalculateSplitsFailure =
  | { kind: 'entry_nao_encontrado' };

export interface CalculateSplitsResult {
  readonly calculated: boolean;
}

export async function calculateSplits(
  tx: TxClient,
  tenantId: string,
  entryId: string,
): Promise<Result<CalculateSplitsResult, CalculateSplitsFailure>> {
  // Verificar que o entry existe
  const { rows: entryRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.entry WHERE id = $1`, [entryId]);
  if (entryRows.length === 0) {
    return err({ kind: 'entry_nao_encontrado' });
  }

  // Delegar para a função SQL SECURITY DEFINER
  await tx.query(`SELECT fin.calculate_splits($1, $2)`, [tenantId, entryId]);

  // Verificar se o split foi criado
  const { rows: splitRows } = await tx.query<{ n: string }>(
    `SELECT count(*) AS n FROM fin.split WHERE entry_id = $1`, [entryId]);
  const calculated = Number(splitRows[0]?.n) > 0;

  return ok({ calculated });
}
