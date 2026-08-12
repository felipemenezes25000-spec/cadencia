import type { Queryable } from './queryable';

export type { Queryable };

export interface CheckResult {
  name: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

export interface VerifyRestoreOptions {
  /** Orçamento de RPO em minutos. Ausente = não mede defasagem (uso local). */
  rpoMinutes?: number;
}

/** Os oito schemas criados pela migration 0002. `pgboss` fica de fora: fila e reconstruivel. */
const REQUIRED_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'ref', 'rpt', 'id'];

async function relationExists(db: Queryable, relation: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>('SELECT to_regclass($1) IS NOT NULL AS existe', [relation]);
  return rows[0]?.existe === true;
}

async function schemasPresent(db: Queryable): Promise<CheckResult> {
  const { rows } = await db.query<{ nspname: string }>(
    'SELECT nspname FROM pg_namespace WHERE nspname = ANY ($1::text[])',
    [REQUIRED_SCHEMAS],
  );
  const achados = new Set(rows.map((r) => r.nspname));
  const faltando = REQUIRED_SCHEMAS.filter((s) => !achados.has(s));
  return {
    name: 'schemas-presentes',
    ok: faltando.length === 0,
    skipped: false,
    detail: faltando.length === 0 ? `${REQUIRED_SCHEMAS.length} schemas presentes` : `faltando: ${faltando.join(', ')}`,
  };
}

async function trailNotEmpty(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'audit.event'))) {
    return { name: 'trilha-não-vazia', ok: false, skipped: true, detail: 'audit.event ausente nesta fase' };
  }
  const { rows } = await db.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');
  const total = Number(rows[0]?.total ?? '0');
  return {
    name: 'trilha-não-vazia',
    ok: total > 0,
    skipped: false,
    detail: `${total} evento(s) em audit.event`,
  };
}

async function sealChain(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'audit.seal'))) {
    return { name: 'cadeia-de-selo', ok: true, skipped: true, detail: 'audit.seal ausente nesta fase' };
  }
  const { rows } = await db.query<{ tenant_id: string; seal_date: string }>(
    `SELECT s.tenant_id, to_char(s.seal_date, 'YYYY-MM-DD') AS seal_date
       FROM audit.seal s
       JOIN LATERAL (
         SELECT p.chain_hash FROM audit.seal p
          WHERE p.tenant_id = s.tenant_id AND p.seal_date < s.seal_date
          ORDER BY p.seal_date DESC LIMIT 1
       ) anterior ON true
      WHERE s.prev_chain_hash IS DISTINCT FROM anterior.chain_hash
      ORDER BY 1, 2`,
  );
  return {
    name: 'cadeia-de-selo',
    ok: rows.length === 0,
    skipped: false,
    detail:
      rows.length === 0
        ? 'cadeia de selo integra'
        : `cadeia rompida em: ${rows.map((r) => `${r.tenant_id}/${r.seal_date}`).join(', ')}`,
  };
}

async function clinicalVersionChain(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'clin.encounter_version'))) {
    return {
      name: 'cadeia-de-versao-clinica',
      ok: true,
      skipped: true,
      detail: 'clin.encounter_version ausente nesta fase',
    };
  }
  const { rows } = await db.query<{ id: string; version_no: number }>(
    `SELECT v.id, v.version_no
       FROM clin.encounter_version v
       JOIN clin.encounter_version p
         ON p.encounter_id = v.encounter_id AND p.version_no = v.version_no - 1
      WHERE v.prev_hash IS DISTINCT FROM p.content_hash
      ORDER BY 1`,
  );
  return {
    name: 'cadeia-de-versao-clinica',
    ok: rows.length === 0,
    skipped: false,
    detail:
      rows.length === 0
        ? 'cadeia de hash das versoes integra'
        : `elos rompidos: ${rows.map((r) => `${r.id}#${r.version_no}`).join(', ')}`,
  };
}

async function rpoWithinBudget(db: Queryable, rpoMinutes: number | undefined): Promise<CheckResult> {
  if (rpoMinutes === undefined) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'sem orcamento de RPO declarado' };
  }
  if (!(await relationExists(db, 'audit.event'))) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'audit.event ausente nesta fase' };
  }
  const { rows } = await db.query<{ lag_minutes: string | null }>(
    `SELECT round(extract(epoch FROM (now() - max(occurred_at))) / 60)::text AS lag_minutes FROM audit.event`,
  );
  const atraso = rows[0]?.lag_minutes;
  if (atraso === null || atraso === undefined) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'nenhum evento para medir defasagem' };
  }
  const minutos = Number(atraso);
  return {
    name: 'rpo',
    ok: minutos <= rpoMinutes,
    skipped: false,
    detail: `evento mais recente tem ${minutos} min (orcamento: ${rpoMinutes} min)`,
  };
}

/**
 * Restauração só vale se for verificada. Cada check diz três coisas: passou, foi
 * pulado (o objeto ainda não existe nesta fase) e por que — check pulado em silêncio
 * é o modo de falha que faz um ensaio inteiro passar sem verificar nada.
 */
export async function verifyRestore(db: Queryable, opts: VerifyRestoreOptions = {}): Promise<CheckResult[]> {
  return [
    await schemasPresent(db),
    await trailNotEmpty(db),
    await sealChain(db),
    await clinicalVersionChain(db),
    await rpoWithinBudget(db, opts.rpoMinutes),
  ];
}
