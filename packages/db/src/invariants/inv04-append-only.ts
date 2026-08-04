import type { Queryable } from '../queryable';

const APPEND_ONLY_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       has_table_privilege('app_rw', c.oid, 'UPDATE')      AS rw_update,
       has_table_privilege('app_rw', c.oid, 'DELETE')      AS rw_delete,
       has_table_privilege('clin_writer', c.oid, 'UPDATE') AS writer_table_update,
       -- text[], nao name[]: o driver nao tem parser para name[] e devolveria a string crua
       coalesce((SELECT array_agg(a.attname::text ORDER BY a.attname)
                   FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                    AND has_column_privilege('clin_writer', c.oid, a.attname, 'UPDATE')),
                '{}'::text[]) AS writer_update_columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'clin'
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'version_id'
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1`;

const CLINICAL_SCOPE_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       (SELECT count(*) FROM pg_policy p
         WHERE p.polrelid = c.oid AND NOT p.polpermissive)::int AS restrictive_policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'clin'
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname IN ('patient_id', 'version_id')
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1`;

export async function appendOnlyViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const { rows } = await db.query<{
    relation: string;
    rw_update: boolean;
    rw_delete: boolean;
    writer_table_update: boolean;
    writer_update_columns: string[];
  }>(APPEND_ONLY_SQL);

  for (const row of rows) {
    if (row.rw_update) out.push(`${row.relation}: app_rw tem UPDATE — tabela com version_id e append-only`);
    if (row.rw_delete) out.push(`${row.relation}: app_rw tem DELETE — tabela com version_id e append-only`);

    if (row.writer_table_update) {
      out.push(`${row.relation}: clin_writer tem UPDATE da tabela inteira — so UPDATE (live) e permitido`);
      continue; // com GRANT de tabela, has_column_privilege devolve todas as colunas
    }

    const extras = row.writer_update_columns.filter((col) => col !== 'live');
    if (extras.length > 0) {
      out.push(`${row.relation}: clin_writer tem UPDATE das colunas ${extras.join(', ')} — so live e permitido`);
    }
  }

  return out;
}

/** As relacoes que o invariante 5 varre — exportada para o teste provar que a varredura nao e vazia. */
export async function clinicalScopeRelations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ relation: string }>(CLINICAL_SCOPE_SQL);
  return rows.map((r) => r.relation);
}

export async function restrictivePolicyViolations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ relation: string; restrictive_policies: number }>(CLINICAL_SCOPE_SQL);
  return rows.filter((r) => r.restrictive_policies === 0).map((r) => `${r.relation}: nenhuma policy RESTRICTIVE`);
}
