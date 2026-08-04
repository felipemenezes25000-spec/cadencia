import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiClient, catalogPool, closeCatalogPool } from './catalog';
import { CRUD_TENANT_A, CRUD_TENANT_B, seedTwoTenants } from './fixtures';
import { readCrudTargets, runCrudMatrix } from './inv10-crud-matrix';

let api: Client;

beforeAll(async () => {
  await seedTwoTenants(catalogPool());
  api = await apiClient();
});

afterAll(async () => {
  await api?.end();
  await closeCatalogPool();
});

describe('invariante 10 — matriz CRUD cruzada, com as tabelas descobertas do catalogo', () => {
  it('nenhuma tabela multi-tenant devolve ou escreve linha do outro tenant', async () => {
    const alvos = await readCrudTargets(catalogPool());
    expect(alvos.length).toBeGreaterThan(0);

    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
    const vazadas = celulas.filter((c) => c.outcome === 'VAZOU');
    expect(vazadas.map((c) => `${c.relation} ${c.operation}: ${c.detail}`)).toEqual([]);
  });

  it('a matriz nao e vaga: as tabelas semeadas tem linha do tenant B e ainda assim devolvem zero', async () => {
    const alvos = await readCrudTargets(catalogPool());
    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
    const semeadas = celulas.filter((c) => c.operation === 'SELECT' && c.seeded);

    expect(semeadas.map((c) => c.relation).sort()).toEqual(['app.clinic', 'app.tenant', 'clin.patient']);
    for (const celula of semeadas) {
      expect(celula.outcome, `${celula.relation}: ${celula.detail}`).toBe('zero_linhas');
    }
  });

  it('o relatorio distingue zero linhas de privilegio negado', async () => {
    const alvos = await readCrudTargets(catalogPool());
    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);

    expect(celulas.every((c) => c.outcome === 'zero_linhas' || c.outcome === 'privilegio_negado')).toBe(true);
    // app_rw tem SELECT e nada mais em audit.event: UPDATE tem de ser privilegio negado.
    expect(celulas.find((c) => c.relation === 'audit.event' && c.operation === 'UPDATE')?.outcome).toBe(
      'privilegio_negado',
    );
  });

  it('pega a tabela que vaza — RLS desligada e GRANT aberto', async () => {
    const admin = catalogPool();
    try {
      // Esta tabela precisa COMMITAR: a conexao do papel api nao enxerga DDL de
      // uma transacao aberta em outra conexao. O DROP no finally e o que a limpa.
      await admin.query('CREATE TABLE clin.__vazamento (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON clin.__vazamento TO app_rw');
      await admin.query('INSERT INTO clin.__vazamento (tenant_id, id) VALUES ($1, gen_random_uuid())', [
        CRUD_TENANT_B,
      ]);

      const alvos = (await readCrudTargets(admin)).filter((t) => t.relation === '__vazamento');
      expect(alvos).toHaveLength(1);

      const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
      expect(celulas.find((c) => c.operation === 'SELECT')?.outcome).toBe('VAZOU');
    } finally {
      await admin.query('DROP TABLE IF EXISTS clin.__vazamento');
    }
  });
});
