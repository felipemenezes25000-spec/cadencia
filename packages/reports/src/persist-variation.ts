import type { TxClient } from '@cadencia/db';
import type { VariationSnapshot } from './variation-types';

/**
 * Persiste o snapshot de variação em rpt.variation_snapshot via o papel `jobs`.
 * Esta função roda no worker (L3), NÃO no caminho de requisição.
 * Usa INSERT ... ON CONFLICT para upsert: se o par de períodos já foi computado,
 * atualiza o resultado.
 *
 * IMPORTANTE: usa a tabela rpt.variation_snapshot diretamente (não a view
 * app_rpt), porque esta função roda como `jobs` (BYPASSRLS) no worker.
 */
export async function persistVariationSnapshot(
  tx: TxClient,
  snapshot: VariationSnapshot,
): Promise<void> {
  await tx.query(
    `INSERT INTO rpt.variation_snapshot
       (tenant_id, clinic_id, period_a_start, period_a_end,
        period_b_start, period_b_end, computed_at, factors)
     VALUES ($1, $2, $3::date, $4::date, $5::date, $6::date, clock_timestamp(), $7::jsonb)
     ON CONFLICT (tenant_id, clinic_id, period_a_start, period_a_end,
                  period_b_start, period_b_end)
     DO UPDATE SET computed_at = clock_timestamp(), factors = EXCLUDED.factors`,
    [
      snapshot.tenantId, snapshot.clinicId,
      snapshot.periodA.start, snapshot.periodA.end,
      snapshot.periodB.start, snapshot.periodB.end,
      JSON.stringify(snapshot.factors),
    ],
  );
}

/**
 * Lê o último snapshot de variação via app_rpt (view security_barrier).
 * Usada pelo caminho de requisição (api), roda sob RLS.
 */
export async function readVariationSnapshot(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  periodA: { start: string; end: string },
  periodB: { start: string; end: string },
): Promise<VariationSnapshot | null> {
  const { rows } = await tx.query<{
    tenant_id: string; clinic_id: string;
    period_a_start: string; period_a_end: string;
    period_b_start: string; period_b_end: string;
    computed_at: string; factors: string;
  }>(
    `SELECT tenant_id::text, clinic_id::text,
            period_a_start::text, period_a_end::text,
            period_b_start::text, period_b_end::text,
            computed_at::text, factors::text
       FROM app_rpt.variation_snapshot
      WHERE tenant_id = $1
        AND clinic_id = $2
        AND period_a_start = $3::date
        AND period_a_end = $4::date
        AND period_b_start = $5::date
        AND period_b_end = $6::date`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  const row = rows[0];
  if (row === undefined) return null;

  return {
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    periodA: { start: row.period_a_start, end: row.period_a_end },
    periodB: { start: row.period_b_start, end: row.period_b_end },
    computedAt: row.computed_at,
    factors: JSON.parse(row.factors) as VariationSnapshot['factors'],
  };
}
