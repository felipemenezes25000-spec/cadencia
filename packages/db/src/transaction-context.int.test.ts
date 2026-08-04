import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const TENANT = '01930000-0000-7000-8000-0000000000a1';

let admin: Pool;
let api: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
  api = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  // Tabela-sonda: existe so para provar o NOINHERIT do papel `api`. O GRANT vai
  // para app_rw e NAO para api — que e exatamente a situacao de toda tabela do
  // sistema. Sem SET LOCAL ROLE app_rw, `api` nao le nada.
  await admin.query('CREATE TABLE IF NOT EXISTS public.noinherit_probe (id int PRIMARY KEY)');
  await admin.query('GRANT USAGE ON SCHEMA public TO app_rw');
  await admin.query('GRANT SELECT ON public.noinherit_probe TO app_rw');
});

afterAll(async () => {
  await admin.query('DROP TABLE IF EXISTS public.noinherit_probe');
  await admin.end();
  await api.end();
});

/** Abre transacao no papel api, aplica o contexto pedido e devolve o cliente. */
async function beginAs(
  ctx: { tenantId?: string; userId?: string; clinicId?: string; actorKind: string },
): Promise<PoolClient> {
  const client = await api.connect();
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE app_rw');
  await client.query(
    `SELECT set_config('app.tenant_id',  $1, TRUE),
            set_config('app.user_id',    $2, TRUE),
            set_config('app.clinic_id',  $3, TRUE),
            set_config('app.actor_kind', $4, TRUE)`,
    [ctx.tenantId ?? '', ctx.userId ?? '', ctx.clinicId ?? '', ctx.actorKind],
  );
  return client;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK');
  client.release();
}

describe('leitura de GUC com nullif (§3.2)', () => {
  it('ator de sistema sem usuario nao explode: current_user_id devolve NULL para string vazia', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'system' });
    try {
      const result = await client.query<{ uid: string | null }>('SELECT app.current_user_id() AS uid');
      expect(result.rows[0]?.uid).toBeNull();
    } finally {
      await rollback(client);
    }
  });

  it('sem o nullif, a mesma leitura levantaria 22P02 e abortaria a transacao do worker', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'system' });
    try {
      // Prova direta do motivo do nullif. Este e o SQL que o desenho original tinha.
      await expect(
        client.query(`SELECT current_setting('app.user_id', true)::uuid`),
      ).rejects.toMatchObject({ code: '22P02' });
    } finally {
      await rollback(client);
    }
  });

  it('current_tenant_id devolve o tenant do preambulo', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'user' });
    try {
      const result = await client.query<{ tid: string | null }>(
        'SELECT app.current_tenant_id() AS tid',
      );
      expect(result.rows[0]?.tid).toBe(TENANT);
    } finally {
      await rollback(client);
    }
  });

  it('sem preambulo nenhum, current_tenant_id devolve NULL em vez de erro (leitura falha fechada)', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      const result = await client.query<{ tid: string | null }>(
        'SELECT app.current_tenant_id() AS tid',
      );
      expect(result.rows[0]?.tid).toBeNull();
    } finally {
      await rollback(client);
    }
  });

  it('require_tenant_id falha alto com 42501 quando o contexto esta ausente (escrita)', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      await expect(client.query('SELECT app.require_tenant_id()')).rejects.toMatchObject({
        code: '42501',
        message: expect.stringContaining('contexto de tenant ausente'),
      });
    } finally {
      await rollback(client);
    }
  });
});

describe('schemas e extensoes', () => {
  it('cria os schemas do desenho com o dono correto, e audit pertence a audit_owner', async () => {
    const result = await admin.query<{ nspname: string; owner: string }>(
      `SELECT n.nspname, r.rolname AS owner
         FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname IN ('app','clin','fin','tiss','ref','id','rpt','audit')
        ORDER BY n.nspname`,
    );
    const owners = Object.fromEntries(result.rows.map((r) => [r.nspname, r.owner]));
    expect(owners).toEqual({
      app: 'app_owner', clin: 'app_owner', fin: 'app_owner', id: 'app_owner',
      ref: 'app_owner', rpt: 'rpt_owner', tiss: 'app_owner',
      // A trilha nasce na 0009 e o schema e de audit_owner: nem app_owner o possui.
      audit: 'audit_owner',
    });
  });

  it('instala as seis extensoes da secao 2.3 tambem por migration, e nao so pelo docker-compose', async () => {
    const result = await admin.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const installed = result.rows.map((r) => r.extname);
    for (const extension of ['pgcrypto', 'btree_gist', 'btree_gin', 'pg_trgm', 'unaccent', 'citext']) {
      expect(installed, `extensao ${extension} ausente`).toContain(extension);
    }
  });
});

describe('NOINHERIT do papel api', () => {
  it('api nao le uma tabela concedida a app_rw antes de SET LOCAL ROLE app_rw', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('SELECT 1 FROM public.noinherit_probe')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await rollback(client);
    }
  });

  it('depois do SET LOCAL ROLE app_rw, a mesma leitura funciona', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'user' });
    try {
      const result = await client.query('SELECT 1 FROM public.noinherit_probe');
      expect(result.rows).toHaveLength(0); // tabela vazia, mas a leitura foi permitida
    } finally {
      await rollback(client);
    }
  });
});
