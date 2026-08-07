import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

let admin: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
});

afterAll(async () => {
  await admin.end();
});

describe('invariante 3 do CI: papeis e posse', () => {
  it('api nao e dono de nenhuma tabela, view, matview, sequencia ou tabela particionada', async () => {
    const result = await admin.query<{ objeto: string }>(
      `SELECT n.nspname || '.' || c.relname AS objeto
         FROM pg_class c
         JOIN pg_roles r ON r.oid = c.relowner
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE r.rolname = 'api'
          AND c.relkind IN ('r', 'p', 'm', 'v', 'f', 'S')
        ORDER BY 1`,
    );
    // Dono desliga RLS com um comando. O papel exposto a internet nunca e dono.
    expect(result.rows.map((r) => r.objeto)).toEqual([]);
  });

  it('somente jobs e rpt_owner tem BYPASSRLS entre papeis nao-superusuario do cluster', async () => {
    const result = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolbypassrls
          AND NOT rolsuper          -- superusuario tem todas as flags; nao e o alvo da regra
          AND rolname NOT LIKE 'pg\\_%'
        ORDER BY rolname`,
    );
    expect(result.rows.map((r) => r.rolname)).toEqual(['jobs', 'rpt_owner']);
  });

  it('nenhum papel funcional da aplicacao faz login', async () => {
    const result = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolcanlogin
          AND rolname IN ('app_owner', 'app_rw', 'clin_writer', 'audit_owner',
                          'rpt_owner', 'app_support')
        ORDER BY rolname`,
    );
    expect(result.rows.map((r) => r.rolname)).toEqual([]);
  });

  it('o pseudo-papel PUBLIC nao tem privilegio nenhum no schema public', async () => {
    const result = await admin.query<{ usage_ok: boolean; create_ok: boolean }>(
      `SELECT has_schema_privilege('public', 'public', 'USAGE')  AS usage_ok,
              has_schema_privilege('public', 'public', 'CREATE') AS create_ok`,
    );
    expect(result.rows[0]?.usage_ok).toBe(false);
    expect(result.rows[0]?.create_ok).toBe(false);
  });

  it('api nao consegue criar tabela em lugar nenhum', async () => {
    const apiPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await expect(apiPool.query('CREATE TABLE public.tentativa (id int)')).rejects.toMatchObject({
        code: '42501', // insufficient_privilege
      });
    } finally {
      await apiPool.end();
    }
  });
});
