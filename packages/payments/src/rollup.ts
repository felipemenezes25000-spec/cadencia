import type { TxClient } from '@cadencia/db';

/**
 * §3.7 — materializa o daily_rollup para um tenant e um dia. O job noturno
 * chama esta funcao para cada tenant ativo. Usa DELETE + INSERT para garantir
 * consistencia: o rollup e pequeno (~240 linhas/mes por clinica) e o custo e
 * irrelevante comparado a complexidade de um UPSERT correto com PK composta
 * de 6 colunas.
 *
 * IMPORTANTE: esta funcao roda com o papel `jobs` (BYPASSRLS) e NAO usa
 * withTenantTx. Ela recebe o pool administrativo diretamente.
 */
export async function materializeRollup(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<{ competencia: number; caixa: number }> {
  // Limpa o dia para recalcular
  await tx.query(
    `DELETE FROM fin.daily_rollup WHERE tenant_id = $1 AND day = $2::date`,
    [tenantId, day]);

  // Base competencia: agregado pelo created_at do lancamento
  const { rowCount: compRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'competencia', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.created_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  // Base caixa: agregado pelo paid_at do lancamento (so os pagos)
  const { rowCount: caixaRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'caixa', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.paid_at IS NOT NULL
       AND e.paid_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  return { competencia: compRows ?? 0, caixa: caixaRows ?? 0 };
}

export interface DivergenceRow {
  readonly clinicId: string;
  readonly day: string;
  readonly basis: string;
  readonly kind: string;
  readonly categoryId: string;
  readonly status: string;
  readonly rollupCents: number;
  readonly liveCents: number;
  readonly rollupEntries: number;
  readonly liveEntries: number;
}

/**
 * Detector de divergencia obrigatorio (§3.7). Compara o rollup materializado
 * com a agregacao ao vivo dos lancamentos. Roda como job noturno apos a
 * materializacao. Qualquer linha retornada indica divergencia que precisa de
 * investigacao. A data da ultima verificacao e exibida no painel.
 */
export async function detectDivergence(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<DivergenceRow[]> {
  const { rows } = await tx.query<{
    clinic_id: string; day: string; basis: string; kind: string;
    category_id: string; status: string;
    rollup_cents: string; live_cents: string;
    rollup_entries: number; live_entries: number;
  }>(
    `WITH live_comp AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.created_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_caixa AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.paid_at IS NOT NULL AND e.paid_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_all AS (
       SELECT clinic_id, 'competencia' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_comp
       UNION ALL
       SELECT clinic_id, 'caixa' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_caixa
     )
     SELECT coalesce(r.clinic_id, l.clinic_id)::text AS clinic_id,
            $2::text AS day,
            coalesce(r.basis, l.basis) AS basis,
            coalesce(r.kind::text, l.kind) AS kind,
            coalesce(r.category_id, l.category_id)::text AS category_id,
            coalesce(r.status, l.status) AS status,
            coalesce(r.amount_cents, 0)::text AS rollup_cents,
            coalesce(l.amount_cents, 0)::text AS live_cents,
            coalesce(r.entries, 0) AS rollup_entries,
            coalesce(l.entries, 0) AS live_entries
       FROM fin.daily_rollup r
       FULL OUTER JOIN live_all l
         ON r.tenant_id = $1
        AND r.day = $2::date
        AND r.clinic_id = l.clinic_id
        AND r.basis = l.basis
        AND r.kind::text = l.kind
        AND r.category_id = l.category_id
        AND r.status = l.status
      WHERE (r.tenant_id = $1 OR r.tenant_id IS NULL)
        AND (coalesce(r.amount_cents, 0) != coalesce(l.amount_cents, 0)
          OR coalesce(r.entries, 0) != coalesce(l.entries, 0))`,
    [tenantId, day]);

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    day: r.day,
    basis: r.basis,
    kind: r.kind,
    categoryId: r.category_id,
    status: r.status,
    rollupCents: Number(r.rollup_cents),
    liveCents: Number(r.live_cents),
    rollupEntries: r.rollup_entries,
    liveEntries: r.live_entries,
  }));
}

// ---------------------------------------------------------------------------
// Wrapper para a funcao SQL fin.refresh_daily_rollup (migration 0080)
// ---------------------------------------------------------------------------

export interface RollupResult {
  readonly divergent: boolean;
  readonly oldTotal: number;
  readonly newTotal: number;
}

export async function refreshDailyRollup(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  day: string,
): Promise<RollupResult> {
  const { rows } = await tx.query<{
    divergent: boolean;
    old_total: string;
    new_total: string;
  }>(
    `SELECT divergent, old_total::text, new_total::text
       FROM fin.refresh_daily_rollup($1, $2, $3::date)`,
    [tenantId, clinicId, day],
  );
  const row = rows[0];
  if (row === undefined) {
    return { divergent: false, oldTotal: 0, newTotal: 0 };
  }
  return {
    divergent: row.divergent,
    oldTotal: Number(row.old_total),
    newTotal: Number(row.new_total),
  };
}
