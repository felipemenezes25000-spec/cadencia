import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const TEST_DB = 'cadencia_harness_test';

function adminUrl(): string {
  const url = process.env.DATABASE_URL_ADMIN;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente: rode `cp .env.example .env` e `pnpm db:up`');
  }
  return url;
}

function testDbUrl(): string {
  const url = new URL(adminUrl());
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

let admin: Pool;
let dir: string;

beforeAll(() => {
  admin = new Pool({ connectionString: adminUrl(), max: 1 });
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  dir = mkdtempSync(join(tmpdir(), 'cadencia-mig-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function queryTestDb<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
  try {
    const result = await pool.query<T>(sql);
    return result.rows;
  } finally {
    await pool.end();
  }
}

describe('pnpm db:migrate', () => {
  it('aplica os arquivos .sql em ordem numerica e registra cada um', async () => {
    // A segunda migration so funciona se a primeira ja tiver rodado.
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');
    writeFileSync(join(dir, '0002_probe_nome.sql'), 'ALTER TABLE public.probe ADD COLUMN nome text;');

    const result = await runMigrations({ connectionString: testDbUrl(), dir });

    expect(result.applied).toEqual(['0001_probe.sql', '0002_probe_nome.sql']);
    const columns = await queryTestDb<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'probe' ORDER BY column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(['id', 'nome']);
  });

  it('e idempotente: a segunda execucao nao reaplica nada', async () => {
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');

    await runMigrations({ connectionString: testDbUrl(), dir });
    const second = await runMigrations({ connectionString: testDbUrl(), dir });

    expect(second.applied).toEqual([]);
    const rows = await queryTestDb<{ version: string }>(
      'SELECT version FROM public.schema_migration ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual(['0001']);
  });

  it('recusa rodar quando uma migration ja aplicada foi editada', async () => {
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');
    await runMigrations({ connectionString: testDbUrl(), dir });

    writeFileSync(
      join(dir, '0001_probe.sql'),
      'CREATE TABLE public.probe (id int PRIMARY KEY, nome text);',
    );

    await expect(runMigrations({ connectionString: testDbUrl(), dir })).rejects.toThrowError(
      /0001_probe\.sql foi alterada depois de aplicada/,
    );
  });

  it('aborta a migration inteira quando o SQL falha no meio, sem registrar meia-migration', async () => {
    writeFileSync(
      join(dir, '0001_probe.sql'),
      ['CREATE TABLE public.probe (id int PRIMARY KEY);', 'CREATE TABLE public.probe (id int);'].join(
        '\n',
      ),
    );

    await expect(runMigrations({ connectionString: testDbUrl(), dir })).rejects.toThrowError(
      /migration 0001_probe\.sql falhou/,
    );

    const tables = await queryTestDb<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'probe'`,
    );
    expect(tables).toEqual([]);
    const applied = await queryTestDb<{ version: string }>(
      'SELECT version FROM public.schema_migration',
    );
    expect(applied).toEqual([]);
  });
});
