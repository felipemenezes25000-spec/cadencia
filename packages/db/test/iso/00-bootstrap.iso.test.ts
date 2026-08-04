import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('bootstrap da suite de isolamento', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('sobe um PostgreSQL 18 com as migrations reais do repositorio aplicadas em ordem', async () => {
    // current_setting em vez de SHOW: SHOW nao aceita alias, e a coluna viria
    // como `server_version_num`, deixando `v` undefined.
    const { rows } = await admin.query<{ v: string }>(
      `SELECT current_setting('server_version_num') AS v`,
    );
    expect(Number(rows[0]!.v)).toBeGreaterThanOrEqual(180000);

    const { rows: fn } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app'
          AND p.proname IN ('current_tenant_id','current_user_id','require_tenant_id')`,
    );
    expect(fn[0]!.n, 'migration 0002 (contexto de transacao) nao foi aplicada').toBe(3);
  });

  it('o papel de login da aplicacao nao e superusuario e nao tem BYPASSRLS', async () => {
    const { rows } = await admin.query<{ super: boolean; bypass: boolean }>(
      `SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'api'`,
    );
    expect(rows[0]).toEqual({ super: false, bypass: false });
  });

  it('sem preambulo, app.current_tenant_id() devolve NULL em vez de explodir', async () => {
    const { rows } = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(rows[0]!.t).toBeNull();
  });
});
