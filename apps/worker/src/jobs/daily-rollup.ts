// apps/worker/src/jobs/daily-rollup.ts
import { jobsPool } from '@cadencia/db';

export interface DailyRollupResult {
  readonly rowsUpserted: number;
  readonly tenantsProcessed: number;
}

/**
 * Materializa fin.daily_rollup a partir de fin.entry.
 *
 * Roda diariamente apos o fechamento do dia. Agrega lancamentos por
 * tenant_id, clinic_id, dia, base (competencia/caixa), kind e status.
 *
 * NAO existe fin.payment — usa fin.entry (00-CONTRATOS.md §3.6).
 * A coluna e amount_cents bigint, NAO amount numeric (§3.7).
 */
export async function materializeDailyRollup(
  opts: { dia?: string } = {},
): Promise<DailyRollupResult> {
  // Se nao especificado, processar o dia anterior NO FUSO DO FILTRO.
  //
  // Era `(clock_timestamp() - interval '1 day')::date`, avaliado no fuso da
  // SESSAO — que e UTC. Os filtros abaixo, porem, convertem `paid_at` e
  // `created_at` para America/Sao_Paulo antes de comparar. As duas datas
  // discordam todo dia entre 21h e meia-noite de Sao Paulo, quando UTC ja virou
  // e Sao Paulo nao: a janela pedia 09/08 e as linhas do dia diziam 08/08.
  //
  // Consequencia em producao: um job agendado para as 23h — horario natural de
  // fechamento do caixa — agregaria o dia ERRADO toda noite, em silencio. O
  // rollup nao fica vazio, fica deslocado, que e pior: o numero existe e esta
  // errado.
  const diaQuery = opts.dia !== undefined
    ? `$1::date`
    : `((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1)`;
  const params = opts.dia !== undefined ? [opts.dia] : [];

  // Upsert no rollup — base 'caixa' agrega por paid_at
  const resultCaixa = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id,
       (e.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'caixa' AS basis,
       e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       e.status::text,
       sum(e.amount_cents) AS amount_cents,
       count(*)::int AS entries
     FROM fin.entry e
     WHERE e.paid_at IS NOT NULL
       AND (e.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY e.tenant_id, e.clinic_id, day, e.kind, e.status, e.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount_cents = EXCLUDED.amount_cents, entries = EXCLUDED.entries`,
    params,
  );

  // Upsert no rollup — base 'competencia' agrega por created_at
  const resultCompetencia = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id,
       (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'competencia' AS basis,
       e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       e.status::text,
       sum(e.amount_cents) AS amount_cents,
       count(*)::int AS entries
     FROM fin.entry e
     WHERE (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY e.tenant_id, e.clinic_id, day, e.kind, e.status, e.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount_cents = EXCLUDED.amount_cents, entries = EXCLUDED.entries`,
    params,
  );

  const rowsUpserted = (resultCaixa.rowCount ?? 0) + (resultCompetencia.rowCount ?? 0);

  // Contar tenants distintos processados
  const { rows } = await jobsPool().query<{ n: string }>(
    `SELECT count(DISTINCT tenant_id)::text AS n FROM fin.daily_rollup
      WHERE day = ${diaQuery}`,
    params,
  );

  return {
    rowsUpserted,
    tenantsProcessed: Number(rows[0]?.n ?? 0),
  };
}
