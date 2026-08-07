// packages/db/src/invariants/inv11-rpt-no-matview-grant.ts
import type { Queryable } from '../queryable';

/**
 * §3.8 / §3.13 item 6 — nenhuma matview tem GRANT para app_rw.
 *
 * Matview nao suporta RLS. Toda matview e exposta EXCLUSIVAMENTE por view
 * security_barrier em app_rpt. Se app_rw recebe GRANT direto, a RLS fundadora
 * e anulada por construcao.
 *
 * O teste varre relkind = 'm' em TODOS os schemas — nao so rpt — porque a
 * regra e universal. O filtro inclui relkind IN ('r','p','m','v','f') do
 * invariante 7, que no desenho original filtrava 'r' e deixava matview
 * invisivel (§3.8).
 */

const SQL = `
SELECT n.nspname || '.' || c.relname AS matview,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       a.privilege_type               AS privilege
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
 WHERE c.relkind = 'm'
   AND coalesce(g.rolname, 'PUBLIC') = 'app_rw'
 ORDER BY 1, 3`;

export interface MatviewGrant {
  matview: string;
  grantee: string;
  privilege: string;
}

export async function matviewGrantsToAppRw(db: Queryable): Promise<MatviewGrant[]> {
  const { rows } = await db.query<MatviewGrant>(SQL);
  return rows;
}

export function matviewGrantViolations(grants: readonly MatviewGrant[]): string[] {
  return grants.map(
    (g) =>
      `${g.matview}: app_rw tem ${g.privilege} — matview NUNCA recebe GRANT para app_rw (§3.8)`,
  );
}
