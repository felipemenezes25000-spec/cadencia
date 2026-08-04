import type { Queryable } from '../queryable';

const APPEND_ONLY_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       coalesce(obj_description(c.oid, 'pg_class'), '')    AS comment,
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

const EXCECAO = 'append-only-except:';

/**
 * Colunas que o clin_writer pode atualizar numa tabela com `version_id`.
 *
 * `live` vale para todas: e o bit que marca se a linha ainda e a verdade vigente,
 * e apaga-lo e o PASSO 6 da finalizacao.
 *
 * Alem dele, a tabela pode DECLARAR NO BANCO colunas extras, via
 * `COMMENT ON TABLE ... IS 'append-only-except: col1, col2'`. Hoje so
 * clin.ai_assistance usa isso (migration 0039), porque a §4.6 exige gravar a
 * decisao do medico antes da finalizacao e o version_id na selagem — enquanto a
 * §3.13 previa apenas `live`, escrita quando `live` era a unica coluna mutavel
 * do dominio clinico.
 *
 * A excecao mora no COMMENT, e nao num Set aqui no codigo, pelo mesmo motivo que
 * a §3.13 exige isso no invariante 1: acrescentar coluna passa a exigir uma
 * migration revisada. Excecao que se altera sem revisao deixa de ser excecao e
 * vira porta.
 */
function colunasPermitidas(comment: string): Set<string> {
  const permitidas = new Set(['live']);
  const i = comment.indexOf(EXCECAO);
  if (i >= 0) {
    for (const col of comment.slice(i + EXCECAO.length).split(',')) {
      const nome = col.trim();
      if (nome !== '') permitidas.add(nome);
    }
  }
  return permitidas;
}

export async function appendOnlyViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const { rows } = await db.query<{
    relation: string;
    comment: string;
    rw_update: boolean;
    rw_delete: boolean;
    writer_table_update: boolean;
    writer_update_columns: string[];
  }>(APPEND_ONLY_SQL);

  for (const row of rows) {
    if (row.rw_update) out.push(`${row.relation}: app_rw tem UPDATE — tabela com version_id e append-only`);
    if (row.rw_delete) out.push(`${row.relation}: app_rw tem DELETE — tabela com version_id e append-only`);

    // GRANT de tabela inteira nunca e aceitavel, nem com excecao declarada: a
    // excecao e por COLUNA, e um GRANT de tabela cobre tambem as colunas que
    // ainda nem existem.
    if (row.writer_table_update) {
      out.push(`${row.relation}: clin_writer tem UPDATE da tabela inteira — a excecao e por coluna, nunca por tabela`);
      continue; // com GRANT de tabela, has_column_privilege devolve todas as colunas
    }

    const permitidas = colunasPermitidas(row.comment);
    const extras = row.writer_update_columns.filter((col) => !permitidas.has(col));
    if (extras.length > 0) {
      const declaradas = [...permitidas].sort().join(', ');
      out.push(
        `${row.relation}: clin_writer tem UPDATE das colunas ${extras.join(', ')} — permitidas: ${declaradas}` +
          ` (para ampliar, escreva migration com COMMENT ON TABLE ... IS '${EXCECAO} ...')`,
      );
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
