import type { Client } from 'pg';
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface CrudTarget {
  schema: string;
  relation: string;
  /** Coluna sabidamente presente, garantida pelo invariante 1. Nunca updated_at. */
  discriminator: string;
  seeded: boolean;
}

export type CrudOutcome = 'zero_linhas' | 'privilegio_negado' | 'VAZOU';

export interface CrudCell {
  relation: string;
  operation: 'SELECT' | 'UPDATE' | 'DELETE';
  outcome: CrudOutcome;
  seeded: boolean;
  detail: string;
}

/** As tres relacoes que a fixture semeia com linha dos DOIS tenants. */
const SEEDED = new Set(['app.tenant', 'app.clinic', 'clin.patient']);

const TARGETS_SQL = `
SELECT n.nspname AS schema,
       c.relname AS relation,
       CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root' THEN 'id' ELSE 'tenant_id' END AS discriminator
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname = CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root'
                             THEN 'id' ELSE 'tenant_id' END)
 ORDER BY 1, 2`;

export async function readCrudTargets(db: Queryable): Promise<CrudTarget[]> {
  const { rows } = await db.query<{ schema: string; relation: string; discriminator: string }>(TARGETS_SQL, [
    [...TENANT_SCHEMAS],
  ]);
  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    discriminator: r.discriminator,
    seeded: SEEDED.has(`${r.schema}.${r.relation}`),
  }));
}

function quoted(target: CrudTarget): string {
  return `"${target.schema}"."${target.relation}"`;
}

async function runCell(
  api: Client,
  target: CrudTarget,
  operation: CrudCell['operation'],
  tenantA: string,
  tenantB: string,
): Promise<CrudCell> {
  const relation = `${target.schema}.${target.relation}`;
  const disc = `"${target.discriminator}"`;
  const sql =
    operation === 'SELECT'
      ? `SELECT 1 FROM ${quoted(target)} WHERE ${disc} = $1`
      : operation === 'UPDATE'
        ? `UPDATE ${quoted(target)} SET ${disc} = ${disc} WHERE ${disc} = $1`
        : `DELETE FROM ${quoted(target)} WHERE ${disc} = $1`;

  await api.query('BEGIN');
  try {
    // `api` e NOINHERIT: sem SET ROLE nao ha privilegio de app_rw nem policy aplicavel.
    await api.query('SET ROLE app_rw');
    // Ator de sistema: dispensa linha em app.membership e ainda satisfaz app.is_member().
    await api.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', '', TRUE),
              set_config('app.clinic_id', '', TRUE),
              set_config('app.actor_kind', 'system', TRUE),
              set_config('app.request_id', '', TRUE)`,
      [tenantA],
    );

    const resultado = await api.query(sql, [tenantB]);
    const linhas = resultado.rowCount ?? 0;
    return {
      relation,
      operation,
      seeded: target.seeded,
      outcome: linhas === 0 ? 'zero_linhas' : 'VAZOU',
      detail: linhas === 0 ? 'zero linhas com contexto do tenant A' : `${linhas} linha(s) do tenant B alcancadas`,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') {
      return {
        relation,
        operation,
        seeded: target.seeded,
        outcome: 'privilegio_negado',
        detail: 'privilegio ausente (42501)',
      };
    }
    throw new Error(`${relation} ${operation} falhou com ${code}: ${(error as Error).message}`);
  } finally {
    await api.query('ROLLBACK').catch(() => undefined);
    await api.query('RESET ROLE').catch(() => undefined);
  }
}

export async function runCrudMatrix(
  api: Client,
  targets: readonly CrudTarget[],
  tenantA: string,
  tenantB: string,
): Promise<CrudCell[]> {
  const celulas: CrudCell[] = [];
  for (const target of targets) {
    for (const operation of ['SELECT', 'UPDATE', 'DELETE'] as const) {
      celulas.push(await runCell(api, target, operation, tenantA, tenantB));
    }
  }
  return celulas;
}

/** So as celulas que reprovam — e o que o runner da Task 46 publica. */
export function crudViolations(cells: readonly CrudCell[]): string[] {
  return cells
    .filter((c) => c.outcome === 'VAZOU')
    .map((c) => `${c.relation} ${c.operation}: ${c.detail}`);
}
