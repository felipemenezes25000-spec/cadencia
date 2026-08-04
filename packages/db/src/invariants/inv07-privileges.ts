import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

/** packages/db/privileges.json — resolvido pelo modulo, nao pelo cwd de quem chama. */
export const PRIVILEGES_FILE = fileURLToPath(new URL('../../privileges.json', import.meta.url));

export interface RelationGrants {
  table: Record<string, string[]>;
  columns?: Record<string, Record<string, string[]>>;
}

export type GrantMap = Record<string, RelationGrants>;

/** Privilegio do dono e consequencia da posse, nao GRANT: fica de fora da declaracao. */
const TABLE_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       a.privilege_type               AS privilege
  FROM pg_class c
  JOIN pg_namespace n     ON n.oid = c.relnamespace
  JOIN pg_roles proprietario ON proprietario.oid = c.relowner
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g    ON g.oid = a.grantee
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND NOT c.relispartition
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3`;

const COLUMN_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       att.attname                    AS column_name,
       a.privilege_type               AS privilege
  FROM pg_attribute att
  JOIN pg_class c         ON c.oid = att.attrelid
  JOIN pg_namespace n     ON n.oid = c.relnamespace
  JOIN pg_roles proprietario ON proprietario.oid = c.relowner
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  LEFT JOIN pg_roles g    ON g.oid = a.grantee
 WHERE n.nspname = ANY ($1::text[])
   AND att.attnum > 0 AND NOT att.attisdropped
   AND att.attacl IS NOT NULL
   AND NOT c.relispartition
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3, 4`;

/**
 * Relacoes existentes, inclusive as SEM nenhum GRANT — que sao o caso perigoso.
 * Particao fica de fora: o nome dela muda todo mes (event_202608, event_202609) e
 * o arquivo declarado viraria ruido mensal em vez de revisao.
 */
const RELATIONS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND NOT c.relispartition
 ORDER BY 1`;

export async function readEffectiveGrants(db: Queryable): Promise<GrantMap> {
  const mapa: GrantMap = {};

  const relacoes = await db.query<{ relation: string }>(RELATIONS_SQL, [[...TENANT_SCHEMAS]]);
  for (const row of relacoes.rows) {
    mapa[row.relation] = { table: {} };
  }

  const tabela = await db.query<{ relation: string; grantee: string; privilege: string }>(TABLE_GRANTS_SQL, [
    [...TENANT_SCHEMAS],
  ]);
  for (const row of tabela.rows) {
    const entrada = (mapa[row.relation] ??= { table: {} });
    (entrada.table[row.grantee] ??= []).push(row.privilege);
  }

  const coluna = await db.query<{
    relation: string;
    grantee: string;
    column_name: string;
    privilege: string;
  }>(COLUMN_GRANTS_SQL, [[...TENANT_SCHEMAS]]);
  for (const row of coluna.rows) {
    const entrada = (mapa[row.relation] ??= { table: {} });
    const colunas = (entrada.columns ??= {});
    const porPapel = (colunas[row.grantee] ??= {});
    (porPapel[row.column_name] ??= []).push(row.privilege);
  }

  return sortDeep(mapa);
}

/** Ordem estavel: o diff tem que mostrar mudanca de privilegio, nunca mudanca de ordem. */
function sortDeep(mapa: GrantMap): GrantMap {
  const out: GrantMap = {};
  for (const relacao of Object.keys(mapa).sort()) {
    const entrada = mapa[relacao]!;
    const table: Record<string, string[]> = {};
    for (const papel of Object.keys(entrada.table).sort()) {
      table[papel] = [...entrada.table[papel]!].sort();
    }
    const resultado: RelationGrants = { table };
    if (entrada.columns) {
      const columns: Record<string, Record<string, string[]>> = {};
      for (const papel of Object.keys(entrada.columns).sort()) {
        const porColuna: Record<string, string[]> = {};
        for (const coluna of Object.keys(entrada.columns[papel]!).sort()) {
          porColuna[coluna] = [...entrada.columns[papel]![coluna]!].sort();
        }
        columns[papel] = porColuna;
      }
      resultado.columns = columns;
    }
    out[relacao] = resultado;
  }
  return out;
}

export function readDeclaredGrants(): GrantMap {
  if (!existsSync(PRIVILEGES_FILE)) {
    throw new Error(
      `${PRIVILEGES_FILE} nao existe: rode \`pnpm db:privileges\` e revise o arquivo gerado antes de commitar`,
    );
  }
  return JSON.parse(readFileSync(PRIVILEGES_FILE, 'utf8')) as GrantMap;
}

export function writeDeclaredGrants(atual: GrantMap): void {
  writeFileSync(PRIVILEGES_FILE, `${JSON.stringify(atual, null, 2)}\n`, 'utf8');
}

export function diffDeclaredGrants(atual: GrantMap, declarado: GrantMap): string[] {
  const out: string[] = [];

  for (const relacao of Object.keys(atual)) {
    const esperado = declarado[relacao];
    if (esperado === undefined) {
      out.push(`${relacao}: relacao existe no banco e nao esta declarada em packages/db/privileges.json`);
      continue;
    }
    const a = JSON.stringify(atual[relacao]);
    const d = JSON.stringify(sortDeep({ x: esperado }).x);
    if (a !== d) {
      out.push(`${relacao}: privilegios divergem — banco ${a} · declarado ${d}`);
    }
  }

  for (const relacao of Object.keys(declarado)) {
    if (!(relacao in atual)) {
      out.push(`${relacao}: declarada em packages/db/privileges.json e inexistente no banco`);
    }
  }

  return out.sort();
}
