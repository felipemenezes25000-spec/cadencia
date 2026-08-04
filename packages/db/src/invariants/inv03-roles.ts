import type { Queryable } from '../queryable';

export interface RoleRow {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  createDb: boolean;
  createRole: boolean;
  canLogin: boolean;
  inherit: boolean;
  config: string[];
}

/**
 * Os nove papeis da §3.1 — os unicos sujeitos ao invariante 3. O superusuario do
 * cluster (o `postgres` do compose, o mestre do RDS) tem `rolbypassrls = true` por
 * construcao do initdb e nao e papel de aplicacao. Por isso o check varre este
 * conjunto fechado e, separadamente, afirma que nenhum deles e superuser.
 */
export const APP_ROLES: ReadonlySet<string> = new Set([
  'app_owner',
  'app_rw',
  'clin_writer',
  'audit_owner',
  'rpt_owner',
  'app_support',
  'api',
  'support',
  'jobs',
]);

const ROLES_SQL = `
SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls,
       rolcreatedb AS create_db, rolcreaterole AS create_role,
       rolcanlogin AS can_login, rolinherit AS inherit,
       coalesce(rolconfig, '{}'::text[]) AS config
  FROM pg_roles
 WHERE rolname NOT LIKE 'pg\\_%'
 ORDER BY rolname`;

const OWNED_SQL = `
SELECT n.nspname || '.' || c.relname AS object
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r     ON r.oid = c.relowner
 WHERE r.rolname = 'api'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
 UNION ALL
SELECT 'schema ' || n.nspname
  FROM pg_namespace n
  JOIN pg_roles r ON r.oid = n.nspowner
 WHERE r.rolname = 'api'
 ORDER BY 1`;

/** audit.event E as particoes dela: GRANT na particao e a porta dos fundos. */
const AUDIT_GRANTS_SQL = `
WITH trilha AS (
  SELECT c.oid, n.nspname || '.' || c.relname AS object, c.relowner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'audit' AND c.relname = 'event'
   UNION ALL
  SELECT c.oid, n.nspname || '.' || c.relname, c.relowner
    FROM pg_inherits i
    JOIN pg_class c     ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE i.inhparent = 'audit.event'::regclass
)
SELECT t.object,
       coalesce(g.rolname, 'PUBLIC') AS grantee,
       a.privilege_type              AS privilege
  FROM trilha t
  CROSS JOIN LATERAL aclexplode(coalesce(
    (SELECT c.relacl FROM pg_class c WHERE c.oid = t.oid),
    acldefault('r', t.relowner))) a
  LEFT JOIN pg_roles g     ON g.oid = a.grantee
  JOIN pg_roles proprietario ON proprietario.oid = t.relowner
 WHERE a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3`;

const RPT_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS object,
       coalesce(g.rolname, 'PUBLIC') AS grantee,
       a.privilege_type              AS privilege
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
 WHERE n.nspname = 'rpt'
   AND coalesce(g.rolname, 'PUBLIC') IN ('app_rw', 'api', 'PUBLIC')
 ORDER BY 1, 2, 3`;

export async function readRoles(db: Queryable): Promise<RoleRow[]> {
  const { rows } = await db.query<{
    name: string;
    superuser: boolean;
    bypass_rls: boolean;
    create_db: boolean;
    create_role: boolean;
    can_login: boolean;
    inherit: boolean;
    config: string[];
  }>(ROLES_SQL);

  return rows.map((r) => ({
    name: r.name,
    superuser: r.superuser,
    bypassRls: r.bypass_rls,
    createDb: r.create_db,
    createRole: r.create_role,
    canLogin: r.can_login,
    inherit: r.inherit,
    config: r.config,
  }));
}

export async function roleViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const papeis = (await readRoles(db)).filter((r) => APP_ROLES.has(r.name));

  const bypass = papeis.filter((r) => r.bypassRls).map((r) => r.name);
  if (bypass.length !== 1 || bypass[0] !== 'jobs') {
    out.push(`mais de um papel com BYPASSRLS: ${bypass.join(', ')} — so jobs pode ter`);
  }

  const supers = papeis.filter((r) => r.superuser).map((r) => r.name);
  if (supers.length > 0) {
    out.push(`papel de aplicacao com SUPERUSER: ${supers.join(', ')} — superuser vence REVOKE e RLS`);
  }

  const api = papeis.find((r) => r.name === 'api');
  if (!api) {
    out.push('papel api nao existe');
  } else {
    if (api.superuser) out.push('api e superuser');
    if (api.bypassRls) out.push('api tem BYPASSRLS');
    if (api.createDb) out.push('api tem CREATEDB');
    if (api.createRole) out.push('api tem CREATEROLE');
    if (api.inherit) out.push('api tem INHERIT — deve ser NOINHERIT e usar SET LOCAL ROLE app_rw');
    if (!api.config.includes('row_security=on')) out.push('api sem row_security=on no papel');
  }

  const { rows } = await db.query<{ object: string }>(OWNED_SQL);
  for (const row of rows) {
    out.push(
      `api e dona de ${row.object} — dono desliga RLS e derruba policy, o isolamento inteiro vira decoracao`,
    );
  }

  return out;
}

export async function forbiddenGrantViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];

  const trilha = await db.query<{ object: string; grantee: string; privilege: string }>(AUDIT_GRANTS_SQL);
  for (const row of trilha.rows) {
    out.push(`${row.object}: GRANT ${row.privilege} para ${row.grantee} — a trilha so se escreve por audit.log`);
  }

  const rpt = await db.query<{ object: string; grantee: string; privilege: string }>(RPT_GRANTS_SQL);
  for (const row of rpt.rows) {
    out.push(
      `${row.object}: GRANT ${row.privilege} para ${row.grantee} — rpt e exposto so por view security_barrier`,
    );
  }

  return out;
}
