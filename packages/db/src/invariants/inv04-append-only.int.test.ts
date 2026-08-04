import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { appendOnlyViolations, clinicalScopeRelations, restrictivePolicyViolations } from './inv04-append-only';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 4 — imutabilidade clinica por REVOKE, nao por convencao', () => {
  it('nenhuma tabela de clin com version_id e atualizavel ou apagavel por app_rw', async () => {
    expect(await appendOnlyViolations(catalogPool())).toEqual([]);
  });

  it('reprova UPDATE concedido a app_rw em tabela versionada', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT SELECT, UPDATE ON clin.__diagnostico TO app_rw');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain('clin.__diagnostico: app_rw tem UPDATE — tabela com version_id e append-only');
  });

  it('reprova DELETE concedido a app_rw em tabela versionada', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT DELETE ON clin.__diagnostico TO app_rw');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain('clin.__diagnostico: app_rw tem DELETE — tabela com version_id e append-only');
  });

  it('reprova clin_writer com UPDATE da tabela inteira em vez de so da coluna live', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        code text NOT NULL, live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT INSERT, UPDATE ON clin.__diagnostico TO clin_writer');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain(
      'clin.__diagnostico: clin_writer tem UPDATE da tabela inteira — a excecao e por coluna, nunca por tabela',
    );
  });

  it('a excecao declarada por COMMENT amplia as colunas, e so as declaradas', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        decidido_em timestamptz(3), intruso text, live boolean NOT NULL DEFAULT true)`);
      await c.query(
        'GRANT UPDATE (live, decidido_em, intruso) ON clin.__diagnostico TO clin_writer',
      );
      await c.query(
        "COMMENT ON TABLE clin.__diagnostico IS 'append-only-except: decidido_em'",
      );
      return appendOnlyViolations(c);
    });
    // `decidido_em` foi declarada e passa; `intruso` nao foi e continua reprovando.
    expect(violacoes.join('\n')).toContain('clin_writer tem UPDATE das colunas intruso');
    expect(violacoes.join('\n')).not.toContain('decidido_em —');
  });

  it('sem a declaracao por COMMENT, a mesma coluna extra reprova', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        decidido_em timestamptz(3), live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT UPDATE (live, decidido_em) ON clin.__diagnostico TO clin_writer');
      return appendOnlyViolations(c);
    });
    expect(violacoes.join('\n')).toContain('clin_writer tem UPDATE das colunas decidido_em');
  });

  it('aceita o unico UPDATE legitimo: clin_writer sobre a coluna live', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        code text NOT NULL, live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT SELECT ON clin.__diagnostico TO app_rw');
      await c.query('GRANT INSERT, UPDATE (live) ON clin.__diagnostico TO clin_writer');
      return appendOnlyViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__diagnostico'))).toEqual([]);
  });
});

describe('invariante 5 — sem policy RESTRICTIVE o compartilhamento e contornavel trocando de tabela', () => {
  it('a varredura enxerga as tabelas clinicas com patient_id — nao passa por vacuo', async () => {
    // clin.encounter_field_value entrou na lista com a migration 0034: e a
    // primeira tabela com a coluna `version_id` literal. clin.encounter_version
    // continua de fora porque a coluna dela chama supersedes_version_id.
    // As quatro tabelas de primeira classe (migration 0035) entraram por terem
    // patient_id E version_id: sao prontuario, e o compartilhamento tem que valer
    // nelas tanto quanto no atendimento de onde saíram.
    // clin.ai_assistance entrou com a migration 0036 pelo mesmo motivo: o apoio
    // por IA e parte do prontuario, nao um log paralelo.
    expect(await clinicalScopeRelations(catalogPool())).toEqual([
      'clin.ai_assistance',
      'clin.attachment',
      'clin.diagnosis',
      'clin.document',
      'clin.encounter',
      'clin.encounter_field_value',
      'clin.encounter_finding',
      'clin.observation',
      'clin.patient_identifier',
      'clin.procedure',
      'clin.record_share',
    ]);
  });

  it('toda tabela de clin com patient_id ou version_id tem ao menos uma policy RESTRICTIVE', async () => {
    expect(await restrictivePolicyViolations(catalogPool())).toEqual([]);
  });

  it('reprova tabela clinica com so policy PERMISSIVE', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__observacao (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL)`);
      await c.query('ALTER TABLE clin.__observacao ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__observacao FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__observacao AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      return restrictivePolicyViolations(c);
    });
    expect(violacoes).toContain('clin.__observacao: nenhuma policy RESTRICTIVE');
  });

  it('clin.patient continua de fora: ela e cadastro, nao prontuario (§10 item 18)', async () => {
    expect(await clinicalScopeRelations(catalogPool())).not.toContain('clin.patient');
  });
});
