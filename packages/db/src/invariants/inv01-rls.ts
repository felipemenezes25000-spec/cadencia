import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface RelationRls {
  schema: string;
  relation: string;
  relkind: string;
  comment: string | null;
  hasDiscriminator: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: number;
  securityInvoker: boolean;
}

const SQL = `
SELECT n.nspname                          AS schema,
       c.relname                          AS relation,
       c.relkind::text                    AS relkind,
       obj_description(c.oid, 'pg_class') AS comment,
       EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname = CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root'
                                 THEN 'id' ELSE 'tenant_id' END
       )                                  AS has_discriminator,
       c.relrowsecurity                   AS rls_enabled,
       c.relforcerowsecurity              AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies,
       EXISTS (
         SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
          WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on')
       )                                  AS security_invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'm', 'v', 'f')
 ORDER BY 1, 2`;

export async function readRelations(db: Queryable): Promise<RelationRls[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    relkind: string;
    comment: string | null;
    has_discriminator: boolean;
    rls_enabled: boolean;
    rls_forced: boolean;
    policies: number;
    security_invoker: boolean;
  }>(SQL, [[...TENANT_SCHEMAS]]);

  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    relkind: r.relkind,
    comment: r.comment,
    hasDiscriminator: r.has_discriminator,
    rlsEnabled: r.rls_enabled,
    rlsForced: r.rls_forced,
    policies: r.policies,
    securityInvoker: r.security_invoker,
  }));
}

export function rlsViolations(relations: readonly RelationRls[]): string[] {
  const out: string[] = [];

  for (const rel of relations) {
    const nome = `${rel.schema}.${rel.relation}`;
    if (rel.comment === 'global-reference') continue;

    if (rel.relkind === 'm') {
      out.push(
        `${nome}: matview em schema multi-tenant — matview nao suporta RLS; ela mora em rpt e e exposta por view security_barrier`,
      );
      continue;
    }
    if (rel.relkind === 'f') {
      out.push(`${nome}: foreign table em schema multi-tenant — RLS nao se aplica a tabela estrangeira`);
      continue;
    }
    if (rel.relkind === 'v') {
      if (!rel.securityInvoker) {
        out.push(
          `${nome}: view sem security_invoker=true — executa com os privilegios do dono e ignora a RLS de quem chama`,
        );
      }
      continue;
    }

    if (!rel.hasDiscriminator) out.push(`${nome}: sem coluna tenant_id`);
    if (!rel.rlsEnabled) out.push(`${nome}: RLS nao habilitada`);
    if (!rel.rlsForced) out.push(`${nome}: RLS nao forcada — o dono da tabela escapa da policy`);
    if (rel.policies === 0) out.push(`${nome}: nenhuma policy`);
  }

  return out;
}
