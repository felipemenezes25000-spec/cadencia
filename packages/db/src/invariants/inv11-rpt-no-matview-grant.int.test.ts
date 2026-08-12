// packages/db/src/invariants/inv11-rpt-no-matview-grant.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { matviewGrantsToAppRw, matviewGrantViolations } from './inv11-rpt-no-matview-grant';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 11 — nenhuma matview tem GRANT para app_rw (§3.8)', () => {
  it('nenhuma matview em qualquer schema tem GRANT para app_rw', async () => {
    const grants = await matviewGrantsToAppRw(catalogPool());
    expect(matviewGrantViolations(grants)).toEqual([]);
  });

  it('reprova matview com GRANT para app_rw (regressao)', async () => {
    const violations = await inRollbackTx(async (c) => {
      await c.query(`
        CREATE MATERIALIZED VIEW app.__mv_teste AS
        SELECT 1 AS x WITH NO DATA`);
      await c.query('GRANT SELECT ON app.__mv_teste TO app_rw');
      return matviewGrantViolations(await matviewGrantsToAppRw(c));
    });
    expect(violations).toContain(
      'app.__mv_teste: app_rw tem SELECT — matview NUNCA recebe GRANT para app_rw (§3.8)',
    );
  });

  it('aceita matview sem GRANT algum (o caso correto)', async () => {
    const violations = await inRollbackTx(async (c) => {
      await c.query(`
        CREATE MATERIALIZED VIEW app.__mv_limpa AS
        SELECT 1 AS x WITH NO DATA`);
      // Sem GRANT — matview só é acessada via view security_barrier
      return matviewGrantViolations(await matviewGrantsToAppRw(c));
    });
    // Não deve conter a matview limpa
    expect(violations.some((v) => v.includes('__mv_limpa'))).toBe(false);
  });
});
