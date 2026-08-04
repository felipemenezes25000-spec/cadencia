import { afterAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from './index';

describe('clin.stale_drafts', () => {
  afterAll(async () => { await closePools(); });

  it('roda com o papel jobs — o unico com BYPASSRLS — e enxerga todos os tenants', async () => {
    const { rows } = await jobsPool().query<{ has: boolean }>(
      `SELECT has_function_privilege('jobs', 'clin.stale_drafts(interval)', 'EXECUTE') AS has`);
    expect(rows[0]?.has).toBe(true);
  });

  it('app_rw NAO pode executar a varredura de todos os tenants', async () => {
    const { rows } = await jobsPool().query<{ has: boolean }>(
      `SELECT has_function_privilege('app_rw', 'clin.stale_drafts(interval)', 'EXECUTE') AS has`);
    expect(rows[0]?.has).toBe(false);
  });

  it('devolve as cinco colunas que o worker precisa para montar o Actor', async () => {
    const { fields } = await jobsPool().query(
      `SELECT * FROM clin.stale_drafts(interval '7 days') LIMIT 0`);
    expect(fields.map((f) => f.name)).toEqual([
      'tenant_id', 'encounter_id', 'professional_id', 'clinic_id', 'updated_at',
    ]);
  });

  it('nao lista rascunho recem-tocado', async () => {
    const { rowCount } = await jobsPool().query(
      `SELECT 1 FROM clin.stale_drafts(interval '7 days')`);
    expect(rowCount).toBe(0);
  });
});
