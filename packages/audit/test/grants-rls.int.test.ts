import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';

const TENANT_A = '0192f8a0-0000-7000-8000-00000000010a';
const TENANT_B = '0192f8a0-0000-7000-8000-00000000010b';

const INSERT_SQL = `
  INSERT INTO audit.event
    (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
  VALUES ($1, 'system', 'ENCOUNTER_FINALIZE', 'clin', 'encounter_version', 'sucesso', '{}'::jsonb)`;

describe('audit.event: privilegios e RLS', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
    await owner.query(INSERT_SQL, [TENANT_A]);
    await owner.query(INSERT_SQL, [TENANT_B]);
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('o dono da trilha consegue inserir: a policy writer existe', async () => {
    await expect(owner.query(INSERT_SQL, [TENANT_A])).resolves.toBeTruthy();
  });

  it('a trilha nasce morta se a policy writer sumir: o INSERT do dono viola a RLS', async () => {
    await owner.query('BEGIN');
    await owner.query('DROP POLICY writer ON audit.event');

    // Este é exatamente o erro que quebraria clin.finalize_encounter no
    // primeiro deploy: a transação de negócio aborta e nenhum atendimento
    // pode ser finalizado.
    await expect(owner.query(INSERT_SQL, [TENANT_A])).rejects.toMatchObject({
      code: '42501',
    });

    await owner.query('ROLLBACK');

    // E depois do rollback a trilha volta a funcionar.
    await expect(owner.query(INSERT_SQL, [TENANT_A])).resolves.toBeTruthy();
  });

  it('a aplicacao nao tem INSERT, UPDATE nem DELETE na trilha', async () => {
    const res = await root.query<{ ins: boolean; upd: boolean; del: boolean; sel: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins,
              has_table_privilege('app_rw', 'audit.event', 'UPDATE') AS upd,
              has_table_privilege('app_rw', 'audit.event', 'DELETE') AS del,
              has_table_privilege('app_rw', 'audit.event', 'SELECT') AS sel`,
    );
    expect(res.rows[0]).toEqual({ ins: false, upd: false, del: false, sel: true });
  });

  it('o INSERT direto de app_rw e barrado por privilegio, antes mesmo da RLS', async () => {
    const app = await connectAs('app_rw');
    try {
      await expect(app.query(INSERT_SQL, [TENANT_A])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });

  it('app_rw so enxerga eventos do proprio tenant', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT_A, actorKind: 'system' });
      const res = await app.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM audit.event',
      );
      await app.query('ROLLBACK');
      expect(res.rows.map((r) => r.tenant_id)).toEqual([TENANT_A]);
    } finally {
      await app.end();
    }
  });

  it('sem preambulo de contexto, app_rw le zero linhas da trilha', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      const res = await app.query<{ n: string }>('SELECT count(*) AS n FROM audit.event');
      await app.query('ROLLBACK');
      expect(Number(res.rows[0]?.n)).toBe(0);
    } finally {
      await app.end();
    }
  });

  it('RLS esta habilitada E forcada no pai e em toda particao', async () => {
    const res = await root.query<{ relname: string; rowsecurity: boolean; forced: boolean; policies: string }>(
      `SELECT c.relname,
              c.relrowsecurity AS rowsecurity,
              c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relkind IN ('r','p')
          AND (c.relname = 'event' OR c.relname LIKE 'event\\_%')`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(7);
    for (const row of res.rows) {
      expect({ t: row.relname, rls: row.rowsecurity, forced: row.forced }).toEqual({
        t: row.relname,
        rls: true,
        forced: true,
      });
      expect(Number(row.policies)).toBeGreaterThanOrEqual(1);
    }
  });

  it('audit.ensure_partitions cria particao futura ja com RLS forcada e policies', async () => {
    await root.query('SELECT audit.ensure_partitions(9)');
    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname LIKE 'event\\_%'
          AND c.relrowsecurity AND c.relforcerowsecurity
          AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 2`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(9);
  });
});
