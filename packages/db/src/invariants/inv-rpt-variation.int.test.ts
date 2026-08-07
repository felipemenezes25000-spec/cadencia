import { describe, it, expect, afterAll } from 'vitest';
import { catalogPool, closeCatalogPool } from './catalog';

describe('invariante: rpt.variation_snapshot sem GRANT para app_rw', () => {
  afterAll(async () => { await closeCatalogPool(); });

  it('app_rw nao tem privilegio direto na tabela rpt.variation_snapshot', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'rpt'
          AND table_name = 'variation_snapshot'
          AND grantee = 'app_rw'`
    );
    expect(rows).toHaveLength(0);
  });

  it('app_rw consegue ler via app_rpt.variation_snapshot', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'app_rpt'
          AND table_name = 'variation_snapshot'
          AND grantee = 'app_rw'
          AND privilege_type = 'SELECT'`
    );
    expect(rows).toHaveLength(1);
  });

  it('view app_rpt.variation_snapshot tem security_barrier', async () => {
    const pool = catalogPool();
    const { rows } = await pool.query<{ security_barrier: string }>(
      `SELECT reloptions::text AS security_barrier
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app_rpt'
          AND c.relname = 'variation_snapshot'
          AND c.relkind = 'v'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.security_barrier).toContain('security_barrier=true');
  });
});
