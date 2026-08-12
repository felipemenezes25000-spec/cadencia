import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { diffDeclaredGrants, readDeclaredGrants, readEffectiveGrants } from './inv07-privileges';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 7 — privilegio e afirmado tabela a tabela, nao herdado de default privileges', () => {
  it('os privilegios do banco sao exatamente os declarados em packages/db/privileges.json', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    expect(Object.keys(atual).length).toBeGreaterThan(0);
    expect(diffDeclaredGrants(atual, readDeclaredGrants())).toEqual([]);
  });

  it('reprova a tabela nova sem declaracao — e ela que da 500 na primeira recepcionista as 8h', async () => {
    const diff = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__nova (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await c.query('GRANT SELECT ON app.__nova TO app_rw');
      return diffDeclaredGrants(await readEffectiveGrants(c), readDeclaredGrants());
    });
    expect(diff).toContain('app.__nova: relação existe no banco e não está declarada em packages/db/privileges.json');
  });

  it('reprova a tabela declarada cujo GRANT a migration esqueceu', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    const comExtra = { ...readDeclaredGrants(), 'app.tenant': { table: { app_rw: ['SELECT', 'INSERT'] } } };
    expect(diffDeclaredGrants(atual, comExtra).some((d) => d.startsWith('app.tenant: privilegios divergem'))).toBe(
      true,
    );
  });

  it('reprova declaracao orfa, de tabela que ja nao existe', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    const comFantasma = { ...readDeclaredGrants(), 'clin.tabela_que_nao_existe': { table: { app_rw: ['SELECT'] } } };
    expect(diffDeclaredGrants(atual, comFantasma)).toContain(
      'clin.tabela_que_nao_existe: declarada em packages/db/privileges.json e inexistente no banco',
    );
  });
});
