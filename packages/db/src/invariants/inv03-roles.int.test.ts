import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { APP_ROLES, forbiddenGrantViolations, readRoles, roleViolations } from './inv03-roles';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 3 — o papel de login da aplicacao nao pode desligar o proprio isolamento', () => {
  it('api nao e superuser, nao tem BYPASSRLS, nao cria banco nem papel e nao herda privilegio', async () => {
    const papeis = await readRoles(catalogPool());
    const api = papeis.find((r) => r.name === 'api');
    expect(api, 'papel api nao existe: a migration 0001 nao rodou').toBeDefined();
    expect(api?.superuser).toBe(false);
    expect(api?.bypassRls).toBe(false);
    expect(api?.createDb).toBe(false);
    expect(api?.createRole).toBe(false);
    expect(api?.inherit).toBe(false);
  });

  it('api tem row_security=on fixado no proprio papel', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.find((r) => r.name === 'api')?.config).toContain('row_security=on');
  });

  it('jobs e o unico papel de aplicacao com BYPASSRLS — sem ele o selo e o detector de drift rodariam vendo zero linhas', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.filter((r) => APP_ROLES.has(r.name) && r.bypassRls).map((r) => r.name)).toEqual(['jobs']);
  });

  it('nenhum papel de aplicacao e superuser — superuser vence REVOKE, RLS e trigger', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.filter((r) => APP_ROLES.has(r.name) && r.superuser).map((r) => r.name)).toEqual([]);
  });

  it('api nao e dona de nenhuma relacao nem de nenhum schema', async () => {
    expect(await roleViolations(catalogPool())).toEqual([]);
  });

  it('reprova api dona de tabela', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__minha (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await c.query('ALTER TABLE app.__minha OWNER TO api');
      return roleViolations(c);
    });
    expect(violacoes).toContain(
      'api e dona de app.__minha — dono desliga RLS e derruba policy, o isolamento inteiro vira decoracao',
    );
  });

  it('reprova um segundo papel de aplicacao com BYPASSRLS', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('ALTER ROLE support BYPASSRLS');
      return roleViolations(c);
    });
    expect(violacoes).toContain('mais de um papel com BYPASSRLS: jobs, support — so jobs pode ter');
  });
});

describe('invariante 6 — a trilha nao aceita escrita direta e os relatorios nao vazam pelo rpt', () => {
  it('ninguem alem do dono tem INSERT, UPDATE, DELETE ou TRUNCATE em audit.event nem nas particoes dela', async () => {
    expect(await forbiddenGrantViolations(catalogPool())).toEqual([]);
  });

  it('reprova GRANT INSERT direto em audit.event — evento forjado sem passar por audit.log', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('GRANT INSERT ON audit.event TO app_rw');
      return forbiddenGrantViolations(c);
    });
    expect(violacoes).toContain('audit.event: GRANT INSERT para app_rw — a trilha so se escreve por audit.log');
  });

  it('reprova GRANT INSERT numa PARTICAO da trilha — a porta dos fundos que o GRANT no pai nao mostra', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      const { rows } = await c.query<{ nome: string }>(
        `SELECT c.relname AS nome
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'audit.event'::regclass
          ORDER BY 1 LIMIT 1`,
      );
      const particao = rows[0]?.nome;
      expect(particao, 'audit.event nao tem particao: a migration 0008 nao rodou').toBeDefined();
      await c.query(`GRANT INSERT ON audit.${particao} TO app_rw`);
      return forbiddenGrantViolations(c);
    });
    expect(violacoes.some((v) => v.includes('GRANT INSERT para app_rw — a trilha so se escreve por audit.log'))).toBe(
      true,
    );
  });

  it('reprova qualquer GRANT em rpt.* para app_rw — matview nao suporta RLS', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE rpt.__mv_atendimentos (tenant_id uuid NOT NULL, total int NOT NULL)');
      await c.query('GRANT SELECT ON rpt.__mv_atendimentos TO app_rw');
      return forbiddenGrantViolations(c);
    });
    expect(violacoes).toContain(
      'rpt.__mv_atendimentos: GRANT SELECT para app_rw — rpt e exposto so por view security_barrier',
    );
  });
});
