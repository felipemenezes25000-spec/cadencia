import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
}

let admin: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
});

afterAll(async () => {
  await admin.end();
});

async function role(name: string): Promise<RoleRow | undefined> {
  const result = await admin.query<RoleRow>(
    `SELECT rolname, rolsuper, rolcanlogin, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = $1`,
    [name],
  );
  return result.rows[0];
}

describe('papeis do banco (§3.1)', () => {
  it('cria os seis papeis funcionais sem login', async () => {
    for (const name of [
      'app_owner',
      'app_rw',
      'clin_writer',
      'audit_owner',
      'rpt_owner',
      'app_support',
    ]) {
      const r = await role(name);
      expect(r, `papel ${name} nao existe`).toBeDefined();
      expect(r?.rolcanlogin, `papel ${name} nao pode fazer login`).toBe(false);
    }
  });

  it('cria os tres papeis de login: api, support e jobs', async () => {
    for (const name of ['api', 'support', 'jobs']) {
      const r = await role(name);
      expect(r, `papel ${name} nao existe`).toBeDefined();
      expect(r?.rolcanlogin, `papel ${name} precisa fazer login`).toBe(true);
    }
  });

  it('api nao e superusuario, nao cria banco, nao cria papel e nao herda privilegio', async () => {
    const api = await role('api');
    expect(api?.rolsuper).toBe(false);
    expect(api?.rolcreatedb).toBe(false);
    expect(api?.rolcreaterole).toBe(false);
    expect(api?.rolbypassrls).toBe(false);
    // NOINHERIT: `api` é membro de app_rw mas só usa os privilégios após SET ROLE.
    expect(api?.rolinherit).toBe(false);
  });

  it('api e membro de app_rw e support e membro de app_support', async () => {
    const result = await admin.query<{ member: string; grantee: string }>(
      `SELECT m.rolname AS member, g.rolname AS grantee
         FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member
         JOIN pg_roles g ON g.oid = am.roleid
        WHERE m.rolname IN ('api', 'support')`,
    );
    const pairs = result.rows.map((r) => `${r.member}->${r.grantee}`).sort();
    expect(pairs).toEqual(['api->app_rw', 'support->app_support']);
  });

  it('app_owner e membro de audit_owner: sem isso a migration da trilha nao consegue SET ROLE', async () => {
    const result = await admin.query<{ ok: boolean }>(
      `SELECT pg_has_role('app_owner', 'audit_owner', 'MEMBER') AS ok`,
    );
    expect(result.rows[0]?.ok).toBe(true);
  });

  it('api tem row_security ligado explicitamente na configuracao do papel', async () => {
    const result = await admin.query<{ rolconfig: string[] | null }>(
      `SELECT rolconfig FROM pg_roles WHERE rolname = 'api'`,
    );
    expect(result.rows[0]?.rolconfig ?? []).toContain('row_security=on');
  });
});
