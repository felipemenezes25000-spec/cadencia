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
});
