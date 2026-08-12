import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { fkViolations, orphanIdColumns, readForeignKeys } from './inv02-fk';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 2 — a FK composta e o que transforma bug de aplicacao em 23503', () => {
  it('toda FK para relacao multi-tenant inclui tenant_id e tem duas colunas ou mais', async () => {
    const fks = await readForeignKeys(catalogPool());
    expect(fks.length).toBeGreaterThan(0);
    expect(fkViolations(fks)).toEqual([]);
  });

  it('reprova a FK de coluna unica para tabela multi-tenant — o caminho pelo qual o paciente de outra clinica entra no atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__consulta (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_paciente FOREIGN KEY (patient_id) REFERENCES clin.patient (id))`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes).toContain(
      'clin.__consulta.fk_paciente: FK de coluna única (patient_id) para clin.patient, que é multi-tenant — precisa ser composta com tenant_id',
    );
  });

  it('reprova a FK composta que nao inclui tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__consulta (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL, kind text NOT NULL,
        PRIMARY KEY (id))`);
      await c.query('CREATE UNIQUE INDEX ux__pid_kind ON clin.patient_identifier (patient_id, kind)');
      await c.query(`ALTER TABLE clin.__consulta ADD CONSTRAINT fk_ident
        FOREIGN KEY (patient_id, kind) REFERENCES clin.patient_identifier (patient_id, kind)`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes).toContain(
      'clin.__consulta.fk_ident: FK (patient_id, kind) para clin.patient_identifier não inclui tenant_id',
    );
  });

  it('aceita FK de coluna unica para relacao global, onde a FK composta e impossivel', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE app.__unidade (
        tenant_id uuid NOT NULL REFERENCES app.tenant (id), id uuid NOT NULL, PRIMARY KEY (id))`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes.filter((v) => v.startsWith('app.__unidade'))).toEqual([]);
  });

  it('nenhuma coluna *_id que aponte para uma tabela conhecida fica sem FK', async () => {
    expect(await orphanIdColumns(catalogPool())).toEqual([]);
  });

  it('reprova a coluna *_id sem FK — a fresta por onde entra o id de outro tenant', async () => {
    const orfas = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE fin.__lancamento (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL, PRIMARY KEY (id))`);
      return orphanIdColumns(c);
    });
    expect(orfas).toContain(
      'fin.__lancamento.patient_id: coluna *_id sem FK, com alvo conhecido em clin.patient',
    );
  });

  it('nao reclama de coluna *_id que nao corresponde a tabela nenhuma, como head_version_id', async () => {
    const orfas = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__cache (
        tenant_id uuid NOT NULL, id uuid NOT NULL, head_version_id uuid, PRIMARY KEY (id))`);
      return orphanIdColumns(c);
    });
    expect(orfas.filter((o) => o.includes('__cache'))).toEqual([]);
  });
});
