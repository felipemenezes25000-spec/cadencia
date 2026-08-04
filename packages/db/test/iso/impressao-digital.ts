import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { TENANT_B } from './fixtures';

/**
 * Le, como superusuario (sem RLS), TODA linha de TODA tabela multi-tenant que
 * pertence ao tenant B, e resume em um hash estavel. Roda antes da suite e
 * depois dela: qualquer diferenca significa que a suite, rodando como tenant A,
 * encostou em dado do tenant B.
 */
export async function impressaoDigitalDoTenantB(admin: Client): Promise<string> {
  const { rows: tabelas } = await admin.query<{ nsp: string; rel: string }>(
    `SELECT n.nspname AS nsp, c.relname AS rel
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('app','clin','fin','tiss','audit')
        AND c.relkind IN ('r','p')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY 1, 2`,
  );

  const hash = createHash('sha256');

  // app.tenant nao tem coluna tenant_id: a linha do tenant B entra a parte.
  const raiz = await admin.query<{ linha: string }>(
    `SELECT to_jsonb(t.*)::text AS linha FROM app.tenant t WHERE t.id = $1`,
    [TENANT_B],
  );
  hash.update(`app.tenant\n${raiz.rows.map((r) => r.linha).join('\n')}\n`);

  for (const { nsp, rel } of tabelas) {
    const { rows } = await admin.query<{ linha: string }>(
      `SELECT to_jsonb(x.*)::text AS linha
         FROM "${nsp}"."${rel}" x
        WHERE x.tenant_id = $1
        ORDER BY 1`,
      [TENANT_B],
    );
    hash.update(`${nsp}.${rel}\n${rows.map((r) => r.linha).join('\n')}\n`);
  }

  return hash.digest('hex');
}
