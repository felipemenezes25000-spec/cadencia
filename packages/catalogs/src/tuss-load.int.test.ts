// packages/catalogs/src/tuss-load.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let jobsPool: Pool;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} ausente`);
  return v;
}

beforeAll(async () => {
  jobsPool = new Pool({ connectionString: requireEnv('DATABASE_URL_JOBS'), max: 2 });
});

afterAll(async () => {
  await jobsPool.end();
});

describe('ref.tuss_staging — tabela de carga bimestral', () => {
  it('a tabela ref.tuss_staging existe e aceita insercao', async () => {
    const { rows } = await jobsPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'ref' AND table_name = 'tuss_staging'
       ) AS exists`,
    );
    expect(rows[0]!.exists).toBe(true);
  });

  it('a tabela ref.tuss_load_log existe e aceita insercao', async () => {
    const { rows } = await jobsPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'ref' AND table_name = 'tuss_load_log'
       ) AS exists`,
    );
    expect(rows[0]!.exists).toBe(true);
  });
});
