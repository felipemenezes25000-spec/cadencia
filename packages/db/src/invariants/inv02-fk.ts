import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface ForeignKey {
  schema: string;
  relation: string;
  constraintName: string;
  columns: string[];
  refSchema: string;
  refRelation: string;
  refHasTenantId: boolean;
}

const FK_SQL = `
SELECT n.nspname   AS schema,
       c.relname   AS relation,
       con.conname AS constraint_name,
       -- ::text e obrigatorio: array_agg(attname) devolve name[] (OID 1003), para o qual
       -- o node-pg nao tem parser e entrega a string crua "{a,b}" no lugar do array.
       (SELECT array_agg(a.attname::text ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
       rn.nspname AS ref_schema,
       rc.relname AS ref_relation,
       EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id'
                  AND a.attnum > 0 AND NOT a.attisdropped) AS ref_has_tenant_id
  FROM pg_constraint con
  JOIN pg_class c      ON c.oid  = con.conrelid
  JOIN pg_namespace n  ON n.oid  = c.relnamespace
  JOIN pg_class rc     ON rc.oid = con.confrelid
  JOIN pg_namespace rn ON rn.oid = rc.relnamespace
 WHERE con.contype = 'f'
   AND n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition          -- particao repete a FK do pai
 ORDER BY 1, 2, 3`;

/**
 * `audit` fica de fora da varredura de coluna orfa: a trilha registra tentativa sem
 * contexto e entidade que pode ja nao existir. FK ali faria a trilha recusar
 * justamente o evento que o auditor procura.
 */
const ORPHAN_SCOPE = ['app', 'clin', 'fin', 'tiss'];

const ORPHAN_SQL = `
WITH conhecidas AS (
  SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname IN ('app', 'clin', 'fin', 'tiss', 'audit', 'ref', 'id')
)
SELECT n.nspname AS schema,
       c.relname AS relation,
       a.attname AS column_name,
       (SELECT string_agg(k.nspname || '.' || k.relname, ', ' ORDER BY k.nspname)
          FROM conhecidas k WHERE k.relname = left(a.attname, length(a.attname) - 3)) AS targets
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND a.attnum > 0 AND NOT a.attisdropped
   AND a.attname LIKE '%\\_id'
   AND a.attname <> 'tenant_id'
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM conhecidas k WHERE k.relname = left(a.attname, length(a.attname) - 3))
   AND NOT EXISTS (SELECT 1 FROM pg_constraint con
                    WHERE con.conrelid = c.oid AND con.contype = 'f'
                      AND a.attnum = ANY (con.conkey))
 ORDER BY 1, 2, 3`;

export async function readForeignKeys(db: Queryable): Promise<ForeignKey[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    constraint_name: string;
    columns: string[] | null;
    ref_schema: string;
    ref_relation: string;
    ref_has_tenant_id: boolean;
  }>(FK_SQL, [[...TENANT_SCHEMAS]]);

  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    constraintName: r.constraint_name,
    columns: r.columns ?? [],
    refSchema: r.ref_schema,
    refRelation: r.ref_relation,
    refHasTenantId: r.ref_has_tenant_id,
  }));
}

export function fkViolations(fks: readonly ForeignKey[]): string[] {
  const out: string[] = [];

  for (const fk of fks) {
    // Alvo global (app.tenant, id."user", ref.*): FK composta e impossivel, e e isenta.
    if (!fk.refHasTenantId) continue;

    const onde = `${fk.schema}.${fk.relation}.${fk.constraintName}`;
    const alvo = `${fk.refSchema}.${fk.refRelation}`;
    const cols = fk.columns.join(', ');

    if (fk.columns.length < 2) {
      out.push(
        `${onde}: FK de coluna unica (${cols}) para ${alvo}, que e multi-tenant — precisa ser composta com tenant_id`,
      );
    } else if (!fk.columns.includes('tenant_id')) {
      out.push(`${onde}: FK (${cols}) para ${alvo} nao inclui tenant_id`);
    }
  }

  return out;
}

export async function orphanIdColumns(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    column_name: string;
    targets: string | null;
  }>(ORPHAN_SQL, [ORPHAN_SCOPE]);

  return rows.map(
    (r) => `${r.schema}.${r.relation}.${r.column_name}: coluna *_id sem FK, com alvo conhecido em ${r.targets}`,
  );
}
