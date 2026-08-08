### Task 69: invariante CI — tiss.* no escopo da invariante 1 (RLS forcada) e invariante 8 (DDL lint)

**Arquivos**

- Modificar `packages/db/src/invariants/inv01-rls.int.test.ts`
- Modificar `packages/db/src/invariants/inv08-ddl-lint.int.test.ts`

**Passos**

- [ ] Adicionar teste que confirma que `tiss` pertence ao `TENANT_SCHEMAS` e que tabelas criadas no schema `tiss` sao alcancadas pela invariante 1 (RLS forcada).

```ts
// packages/db/src/invariants/inv01-rls.int.test.ts
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
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 11 testes passam (os novos testes de `tiss` ja passam porque `tiss` ja esta em `TENANT_SCHEMAS` desde a Fase 0).

Saida esperada: 11 testes passando.

- [ ] Adicionar teste que confirma que a invariante 8 (DDL lint) detecta relogio dentro do schema tiss JA existente no banco (nao so em rollback tx sinttetico).

```ts
// packages/db/src/invariants/inv08-ddl-lint.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { ddlLintViolations } from './inv08-ddl-lint';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 8 — os cinco erros que so aparecem meses depois', () => {
  it('o schema atual nao viola nenhuma das cinco proibicoes', async () => {
    expect(await ddlLintViolations(catalogPool())).toEqual([]);
  });

  it('reprova coluna cnpj numerica — CNPJ e alfanumerico desde 01/07/2026', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__fornecedor (tenant_id uuid NOT NULL, id uuid NOT NULL, cnpj bigint)');
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'app.__fornecedor.cnpj e bigint — CNPJ e alfanumerico (^[A-Z0-9]{12}[0-9]{2}$), varchar(14)',
    );
  });

  it('reprova relogio dentro do schema tiss — vale a terminologia da data do atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION tiss.__procedimento_vigente() RETURNS date
                     LANGUAGE sql STABLE AS $fn$ SELECT current_date $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__procedimento_vigente (function): le o relogio dentro do schema tiss');
  });

  it('reprova now() dentro do schema tiss — mesma regra que current_date', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION tiss.__guia_hoje() RETURNS timestamptz
                     LANGUAGE sql STABLE AS $fn$ SELECT now() $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__guia_hoje (function): le o relogio dentro do schema tiss');
  });

  it('reprova cast para date fora de app.local_date — e o que faz a guia sair com a data errada em Rio Branco', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION clin.__dia_do_atendimento(p_at timestamptz) RETURNS date
                     LANGUAGE sql IMMUTABLE AS $fn$ SELECT p_at::date $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'clin.__dia_do_atendimento (function): cast para date fora de app.local_date() — use a coluna occurred_date',
    );
  });

  it('aceita a excecao declarada por COMMENT ON FUNCTION quando o limite vem do relogio, nao do evento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION clin.__proxima_particao() RETURNS date
                     LANGUAGE sql VOLATILE AS $fn$ SELECT (date_trunc('month', now()) + interval '1 month')::date $fn$`);
      await c.query("COMMENT ON FUNCTION clin.__proxima_particao() IS 'clock-derived-date'");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__proxima_particao'))).toEqual([]);
  });

  it('nao reclama de literal com sufixo ::date, que nao e derivacao de timestamptz', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__periodo (
        tenant_id uuid NOT NULL, id uuid NOT NULL, inicio date NOT NULL,
        CONSTRAINT ck_inicio CHECK (inicio >= '2020-01-01'::date))`);
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__periodo'))).toEqual([]);
  });

  it('reprova o valor atendimento em app.consent_type — bloquear atendimento esperando aceite contraria o art. 11 II f', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      // DDL e transacional: o tipo nasce e morre dentro desta transacao.
      await c.query('DROP TYPE IF EXISTS app.consent_type');
      await c.query("CREATE TYPE app.consent_type AS ENUM ('marketing','pesquisa','compartilhamento','atendimento')");
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      "app.consent_type contem o valor 'atendimento' — a base legal da assistencia e o art. 11 II f, nao consentimento",
    );
  });

  it('aceita app.consent_type sem o valor atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('DROP TYPE IF EXISTS app.consent_type');
      await c.query("CREATE TYPE app.consent_type AS ENUM ('marketing','pesquisa','compartilhamento')");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('consent_type'))).toEqual([]);
  });

  it('reprova indice de tabela multi-tenant que nao comeca por tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE INDEX ix__patient_created ON clin.patient (created_at)');
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'clin.patient / ix__patient_created: indice de tabela multi-tenant nao comeca por tenant_id (primeira coluna: created_at)',
    );
  });

  it('aceita a excecao declarada por COMMENT ON INDEX quando a linha ja esta escopada pelo pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE INDEX ix__patient_created ON clin.patient (created_at)');
      await c.query("COMMENT ON INDEX clin.ix__patient_created IS 'tenant-scoped-by-parent'");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('ix__patient_created'))).toEqual([]);
  });

  it('reprova default com now() em tabela tiss — mesmo proibido que funcao', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE tiss.__com_now (
        tenant_id uuid NOT NULL, id uuid NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now())`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__com_now.criado_em (default): le o relogio dentro do schema tiss');
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv08-ddl-lint.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 12 testes passam.

Saida esperada: 12 testes passando.

- [ ] Commitar: `test(invariants): assert tiss schema coverage in RLS and DDL lint invariants`

---