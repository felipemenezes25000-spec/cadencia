import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { CRUD_TENANT_A } from './fixtures';
import { runAllInvariants } from './index';

beforeAll(async () => {
  // O invariante 9 exige trilha com evento. Um `pnpm db:migrate` recem-rodado ainda
  // nao tem nenhum, e o runner reprovaria por um motivo que nao e o deste teste.
  const client = await catalogPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', '', TRUE),
              set_config('app.actor_kind', 'system', TRUE)`,
      [CRUD_TENANT_A],
    );
    await client.query('SELECT audit.log($1, $2, $3, NULL, $4, $5::jsonb)', [
      'INVARIANTS_RUNNER_PROBE',
      'audit',
      'event',
      'sucesso',
      '{}',
    ]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await closeCatalogPool();
});

describe('runner unico dos 10 invariantes', () => {
  it('roda os dez, na ordem da §3.13, e o banco atual nao reprova em nenhum', async () => {
    const resultados = await runAllInvariants(catalogPool());
    expect(resultados.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const reprovados = resultados.filter((r) => r.violations.length > 0);
    expect(reprovados.map((r) => `#${r.number} ${r.name}: ${r.violations.join(' · ')}`)).toEqual([]);
  });

  it('pula a matriz CRUD quando nao recebe conexao do papel api, e diz que pulou', async () => {
    const resultados = await runAllInvariants(catalogPool());
    const matriz = resultados.find((r) => r.number === 10);
    expect(matriz?.skipped).toBe(true);
    expect(matriz?.detail).toContain('conexao do papel api');
  });

  it('reprova junto com o invariante que reprova — uma tabela sem RLS derruba o runner inteiro', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE clin.__sem_rls (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      return runAllInvariants(c);
    });
    const rls = resultados.find((r) => r.number === 1);
    expect(rls?.violations).toContain('clin.__sem_rls: RLS nao habilitada');
  });
});
