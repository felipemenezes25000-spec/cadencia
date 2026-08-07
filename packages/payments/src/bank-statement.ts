import type { TxClient } from '@cadencia/db';

export interface BankStatementInput {
  readonly bankAccountId: string;
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface StatementLine {
  readonly entryId: string;
  readonly kind: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paidAt: string;
  readonly runningBalanceCents: number;
}

export interface BankStatement {
  readonly lines: readonly StatementLine[];
  readonly totalBalanceCents: number;
}

/**
 * Extrato por conta bancaria. Retorna linhas ordenadas por data de pagamento
 * com saldo corrente via window function. O saldo e DERIVADO — nunca campo
 * atualizado. Receitas somam, despesas subtraem.
 *
 * O saldo corrente (running balance) e calculado com:
 *   SUM(CASE WHEN kind='receita' THEN amount_cents ELSE -amount_cents END)
 *   OVER (ORDER BY paid_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
 *
 * A ordenacao inclui id para desempate determinista.
 */
export async function getBankStatement(
  tx: TxClient,
  i: BankStatementInput,
): Promise<BankStatement> {
  const limit = i.limit ?? 500;
  const params: unknown[] = [i.bankAccountId, i.clinicId, i.fromDate, i.toDate, limit + 1];

  let cursorFilter = '';
  if (i.cursor !== undefined) {
    cursorFilter = `AND e.paid_at > $6`;
    params.push(i.cursor);
  }

  const { rows } = await tx.query<{
    entry_id: string;
    kind: string;
    description: string;
    amount_cents: string;
    paid_at: string;
    running_balance_cents: string;
  }>(
    `SELECT
       e.id AS entry_id,
       e.kind::text,
       e.description,
       e.amount_cents::text,
       to_char(e.paid_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
       SUM(
         CASE WHEN e.kind = 'receita' THEN e.amount_cents
              ELSE -e.amount_cents END
       ) OVER (
         ORDER BY e.paid_at, e.id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       )::text AS running_balance_cents
     FROM fin.entry e
     WHERE e.bank_account_id = $1
       AND e.clinic_id = $2
       AND e.paid_at IS NOT NULL
       AND e.paid_at >= $3::date
       AND e.paid_at < ($4::date + 1)
       AND e.status = 'pago'
       ${cursorFilter}
     ORDER BY e.paid_at, e.id
     LIMIT $5`,
    params,
  );

  const lines: StatementLine[] = rows.slice(0, limit).map((r) => ({
    entryId: r.entry_id,
    kind: r.kind,
    description: r.description,
    amountCents: Number(r.amount_cents),
    paidAt: r.paid_at,
    runningBalanceCents: Number(r.running_balance_cents),
  }));

  const totalBalanceCents = lines.length > 0
    ? lines[lines.length - 1]!.runningBalanceCents
    : 0;

  return { lines, totalBalanceCents };
}
