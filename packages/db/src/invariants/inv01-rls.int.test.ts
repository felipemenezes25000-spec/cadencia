import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx, TENANT_SCHEMAS } from './catalog';
import { readRelations, rlsViolations } from './inv01-rls';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 1 — isolamento e propriedade estrutural, nao disciplina de codigo', () => {
  it('toda relacao de app/clin/fin/tiss/audit tem discriminador de tenant, RLS habilitada, forcada e ao menos uma policy', async () => {
    const relacoes = await readRelations(catalogPool());
    // Se a descoberta vier vazia, o teste passaria sem verificar coisa nenhuma.
    expect(relacoes.length).toBeGreaterThan(0);
    expect(rlsViolations(relacoes)).toEqual([]);
  });

  it('reprova a tabela nova criada sem RLS — a migration escrita com pressa na sexta', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE clin.__violacao (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('clin.__violacao: RLS nao habilitada');
    expect(violacoes).toContain('clin.__violacao: RLS nao forcada — o dono da tabela escapa da policy');
    expect(violacoes).toContain('clin.__violacao: nenhuma policy');
  });

  it('reprova a tabela multi-tenant sem coluna tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE fin.__sem_tenant (id uuid NOT NULL)');
      await c.query('ALTER TABLE fin.__sem_tenant ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE fin.__sem_tenant FORCE ROW LEVEL SECURITY');
      await c.query('CREATE POLICY p ON fin.__sem_tenant AS PERMISSIVE FOR ALL TO app_rw USING (true)');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('fin.__sem_tenant: sem coluna tenant_id');
  });

  it("aceita a excecao declarada por COMMENT ON TABLE ... IS 'global-reference' e so por ela", async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__tabela_global (code text PRIMARY KEY)');
      await c.query("COMMENT ON TABLE app.__tabela_global IS 'global-reference'");
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes.filter((v) => v.startsWith('app.__tabela_global'))).toEqual([]);
  });

  it('app.tenant e a raiz do regime: o discriminador dela e id, e a marca vem da migration 0003', async () => {
    const relacoes = await readRelations(catalogPool());
    const tenant = relacoes.find((r) => r.schema === 'app' && r.relation === 'tenant');
    expect(tenant, 'app.tenant nao existe: a migration 0003 nao foi aplicada').toBeDefined();
    // Sem a marca, o invariante acusaria "sem coluna tenant_id" e a tentacao seria
    // marca-la como 'global-reference' — o que a tiraria da matriz CRUD do invariante 10
    // justamente na tabela que define a fronteira entre clinicas.
    expect(tenant?.comment).toBe('tenant-root');
    expect(tenant?.hasDiscriminator).toBe(true);
  });

  it('reprova view sem security_invoker — a view do dono ignora a RLS de quem chama', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE VIEW clin.__v_paciente AS SELECT id FROM clin.patient');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain(
      'clin.__v_paciente: view sem security_invoker=true — executa com os privilegios do dono e ignora a RLS de quem chama',
    );
  });

  it('reprova matview em schema multi-tenant — matview nao suporta RLS e pertence a rpt', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE MATERIALIZED VIEW clin.__mv AS SELECT 1 AS n');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain(
      'clin.__mv: matview em schema multi-tenant — matview nao suporta RLS; ela mora em rpt e e exposta por view security_barrier',
    );
  });

  it('reprova particao que nao recebeu as policies do pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__particionada (
        tenant_id uuid NOT NULL, id uuid NOT NULL, dia date NOT NULL
      ) PARTITION BY RANGE (dia)`);
      await c.query('ALTER TABLE clin.__particionada ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__particionada FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__particionada AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      await c.query(`CREATE TABLE clin.__particionada_2026 PARTITION OF clin.__particionada
        FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('clin.__particionada_2026: RLS nao habilitada');
  });

  it('app.secure_partition faz a particao herdar RLS forcada e as policies do pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__particionada (
        tenant_id uuid NOT NULL, id uuid NOT NULL, dia date NOT NULL
      ) PARTITION BY RANGE (dia)`);
      await c.query('ALTER TABLE clin.__particionada ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__particionada FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__particionada AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      await c.query(`CREATE TABLE clin.__particionada_2026 PARTITION OF clin.__particionada
        FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      await c.query("SELECT app.secure_partition('clin.__particionada_2026'::regclass)");
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes.filter((v) => v.startsWith('clin.__particionada'))).toEqual([]);
  });

  it('tiss pertence ao TENANT_SCHEMAS e tabelas no schema tiss sao alcancadas pelo invariante 1', () => {
    expect(TENANT_SCHEMAS).toContain('tiss');
  });

  it('reprova tabela no schema tiss sem RLS — mesmo erro que clin ou fin', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE tiss.__sem_rls (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('tiss.__sem_rls: RLS nao habilitada');
    expect(violacoes).toContain('tiss.__sem_rls: RLS nao forcada — o dono da tabela escapa da policy');
    expect(violacoes).toContain('tiss.__sem_rls: nenhuma policy');
  });
});
