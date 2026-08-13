import type { PoolClient } from 'pg';
import { ACTIONS } from '../packages/authz/src/actions';
import { catalogRows } from '../packages/authz/src/catalog';

/** Sincroniza o espelho operacional sem transformar o banco em fonte da verdade. */
export async function syncActionCatalog(
  client: Pick<PoolClient, 'query'>,
): Promise<number> {
  const rows = catalogRows(ACTIONS);
  for (const row of rows) {
    await client.query(
      `INSERT INTO ref.action (key, description, roles, requires_mfa)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
         SET description = EXCLUDED.description,
             roles = EXCLUDED.roles,
             requires_mfa = EXCLUDED.requires_mfa,
             generated_at = clock_timestamp()`,
      [row.key, row.description, row.roles, row.requiresMfa],
    );
  }
  await client.query(
    `DELETE FROM ref.action WHERE key <> ALL($1::text[])`,
    [rows.map((row) => row.key)],
  );
  return rows.length;
}
