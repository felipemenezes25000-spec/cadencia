import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

/**
 * Toda expressao PERSISTIDA no banco, de todas as origens onde um erro de DDL se
 * esconde: corpo de funcao, DEFAULT de coluna, CHECK/EXCLUDE, definicao de view e
 * de indice. O `comment` carrega a marca de excecao, quando ela existir.
 */
const EXPRESSIONS_SQL = `
SELECT 'function' AS source_kind, n.nspname AS schema, p.proname AS object_name,
       p.prosrc AS definition, obj_description(p.oid, 'pg_proc') AS comment
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = ANY ($1::text[])
UNION ALL
SELECT 'default', n.nspname, c.relname || '.' || a.attname,
       pg_get_expr(d.adbin, d.adrelid), NULL
  FROM pg_attrdef d
  JOIN pg_class c     ON c.oid = d.adrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
 WHERE n.nspname = ANY ($1::text[])
UNION ALL
SELECT 'constraint', n.nspname, con.conname,
       pg_get_constraintdef(con.oid), obj_description(con.oid, 'pg_constraint')
  FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = ANY ($1::text[]) AND con.contype IN ('c', 'x')
UNION ALL
SELECT 'view', n.nspname, c.relname, pg_get_viewdef(c.oid), obj_description(c.oid, 'pg_class')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[]) AND c.relkind IN ('v', 'm')
UNION ALL
SELECT 'index', n.nspname, i.relname, pg_get_indexdef(i.oid), obj_description(i.oid, 'pg_class')
  FROM pg_index x
  JOIN pg_class i     ON i.oid = x.indexrelid
  JOIN pg_class c     ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])`;

const CNPJ_SQL = `
SELECT n.nspname AS schema, c.relname AS relation, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type_name
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND a.attnum > 0 AND NOT a.attisdropped
   AND a.attname LIKE '%cnpj%'
   AND a.atttypid IN ('numeric'::regtype, 'bigint'::regtype, 'integer'::regtype,
                      'smallint'::regtype, 'double precision'::regtype, 'real'::regtype)
 ORDER BY 1, 2, 3`;

const CONSENT_SQL = `
SELECT e.enumlabel AS label
  FROM pg_enum e
  JOIN pg_type t      ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'app' AND t.typname = 'consent_type'`;

const INDEX_SQL = `
SELECT n.nspname AS schema,
       c.relname AS relation,
       i.relname AS index_name,
       x.indisprimary AS is_primary,
       x.indisunique  AS is_unique,
       obj_description(i.oid, 'pg_class') AS comment,
       coalesce((SELECT a.attname FROM pg_attribute a
                  WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]),
                '(expressao)') AS first_column
  FROM pg_index x
  JOIN pg_class i     ON i.oid = x.indexrelid
  JOIN pg_class c     ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1, 2, 3`;

/** Literal de texto vira '' antes do teste: '2020-01-01'::date e valor, nao derivacao. */
function stripLiterals(definition: string): string {
  return definition.replace(/'[^']*'/g, "''").replace(/''\s*::\s*date\b/gi, "''");
}

const CLOCK_RE = /\b(now\s*\(\s*\)|current_date|current_timestamp|localtimestamp)\b/i;
const DATE_CAST_RE = /(::\s*date\b|\bas\s+date\s*\))/i;

export async function ddlLintViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const schemas = [...TENANT_SCHEMAS];

  const cnpj = await db.query<{ schema: string; relation: string; column_name: string; type_name: string }>(
    CNPJ_SQL,
    [schemas],
  );
  for (const row of cnpj.rows) {
    out.push(
      `${row.schema}.${row.relation}.${row.column_name} e ${row.type_name} — CNPJ e alfanumerico (^[A-Z0-9]{12}[0-9]{2}$), varchar(14)`,
    );
  }

  const expressoes = await db.query<{
    source_kind: string;
    schema: string;
    object_name: string;
    definition: string | null;
    comment: string | null;
  }>(EXPRESSIONS_SQL, [schemas]);

  for (const row of expressoes.rows) {
    const corpo = stripLiterals(row.definition ?? '');
    const rotulo = `${row.schema}.${row.object_name} (${row.source_kind})`;

    if (row.schema === 'tiss' && CLOCK_RE.test(corpo)) {
      out.push(`${rotulo}: le o relogio dentro do schema tiss`);
    }

    const eLocalDate = row.schema === 'app' && row.object_name === 'local_date';
    const marcada = row.comment === 'clock-derived-date';
    if (!eLocalDate && !marcada && DATE_CAST_RE.test(corpo)) {
      out.push(`${rotulo}: cast para date fora de app.local_date() — use a coluna occurred_date`);
    }
  }

  const consent = await db.query<{ label: string }>(CONSENT_SQL);
  for (const row of consent.rows) {
    if (row.label === 'atendimento') {
      out.push(
        "app.consent_type contem o valor 'atendimento' — a base legal da assistencia e o art. 11 II f, nao consentimento",
      );
    }
  }

  const indices = await db.query<{
    schema: string;
    relation: string;
    index_name: string;
    is_primary: boolean;
    is_unique: boolean;
    comment: string | null;
    first_column: string;
  }>(INDEX_SQL, [schemas]);

  for (const row of indices.rows) {
    if (row.is_primary || row.is_unique) continue; // chave global de UUIDv7, por decisao
    if (row.comment === 'tenant-scoped-by-parent') continue;
    if (row.first_column === 'tenant_id') continue;
    out.push(
      `${row.schema}.${row.relation} / ${row.index_name}: indice de tabela multi-tenant nao comeca por tenant_id (primeira coluna: ${row.first_column})`,
    );
  }

  return out;
}
