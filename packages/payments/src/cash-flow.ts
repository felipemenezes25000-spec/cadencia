import type { TxClient } from '@cadencia/db';

export interface CashFlowInput {
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly bankAccountId?: string;
}

export interface CashFlowWeek {
  readonly weekStart: string;
  readonly realizedInCents: number;
  readonly realizedOutCents: number;
  readonly projectedInCents: number;
  readonly projectedOutCents: number;
  readonly netCents: number;
  readonly cumulativeBalanceCents: number;
}

export interface CashFlowProjection {
  readonly weeks: readonly CashFlowWeek[];
}

/**
 * Fluxo de caixa projetado. Combina:
 * - Entries com paid_at (realizado): receitas e despesas efetivamente pagas
 * - Entries com due_date futuro e status=pendente (projetado): receitas e despesas previstas
 *
 * Agrupado por semana (date_trunc('week', data)) com saldo acumulado via window function.
 * O filtro por bank_account_id é opcional: se ausente, mostra todos os lançamentos da clínica.
 */
export async function getCashFlowProjection(
  tx: TxClient,
  i: CashFlowInput,
): Promise<CashFlowProjection> {
  const bankFilter = i.bankAccountId !== undefined
    ? `AND e.bank_account_id = $4`
    : '';
  const params: unknown[] = [i.clinicId, i.fromDate, i.toDate];
  if (i.bankAccountId !== undefined) {
    params.push(i.bankAccountId);
  }

  const { rows } = await tx.query<{
    week_start: string;
    realized_in_cents: string;
    realized_out_cents: string;
    projected_in_cents: string;
    projected_out_cents: string;
    net_cents: string;
    cumulative_balance_cents: string;
  }>(
    `WITH base AS (
       -- Realizado: entries com paid_at no periodo
       SELECT
         date_trunc('week', e.paid_at)::date AS week_start,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS realized_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS realized_out,
         0::bigint AS projected_in,
         0::bigint AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.paid_at IS NOT NULL
         AND e.paid_at >= $2::date
         AND e.paid_at < ($3::date + 1)
         AND e.status IN ('pago')
         ${bankFilter}

       UNION ALL

       -- Projetado: entries pendentes com due_date no periodo
       SELECT
         date_trunc('week', e.due_date)::date AS week_start,
         0::bigint AS realized_in,
         0::bigint AS realized_out,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS projected_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.status = 'pendente'
         AND e.due_date IS NOT NULL
         AND e.due_date >= $2::date
         AND e.due_date <= $3::date
         ${bankFilter}
     ),
     weekly AS (
       SELECT
         week_start,
         SUM(realized_in)::bigint AS realized_in_cents,
         SUM(realized_out)::bigint AS realized_out_cents,
         SUM(projected_in)::bigint AS projected_in_cents,
         SUM(projected_out)::bigint AS projected_out_cents,
         (SUM(realized_in) - SUM(realized_out)
          + SUM(projected_in) - SUM(projected_out))::bigint AS net_cents
       FROM base
       GROUP BY week_start
     )
     SELECT
       to_char(week_start, 'YYYY-MM-DD') AS week_start,
       realized_in_cents::text,
       realized_out_cents::text,
       projected_in_cents::text,
       projected_out_cents::text,
       net_cents::text,
       SUM(net_cents) OVER (ORDER BY week_start
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text
         AS cumulative_balance_cents
     FROM weekly
     ORDER BY week_start`,
    params,
  );

  const weeks: CashFlowWeek[] = rows.map((r) => ({
    weekStart: r.week_start,
    realizedInCents: Number(r.realized_in_cents),
    realizedOutCents: Number(r.realized_out_cents),
    projectedInCents: Number(r.projected_in_cents),
    projectedOutCents: Number(r.projected_out_cents),
    netCents: Number(r.net_cents),
    cumulativeBalanceCents: Number(r.cumulative_balance_cents),
  }));

  return { weeks };
}
