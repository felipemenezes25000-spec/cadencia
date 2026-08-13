import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';
import { ACTIONS } from './actions';
import { can, type AuthzSubject } from './can';

function pnpm(...args: string[]): void {
  const pnpmCli = process.env['npm_execpath'];
  if (pnpmCli) {
    execFileSync(process.execPath, [pnpmCli, ...args], { stdio: 'pipe' });
  } else if (process.platform === 'win32') {
    execFileSync(process.env['ComSpec'] ?? 'cmd.exe',
      ['/d', '/s', '/c', 'pnpm.cmd', ...args], { stdio: 'pipe' });
  } else {
    execFileSync('pnpm', args, { stdio: 'pipe' });
  }
}

// O slug e o email levam o uuid INTEIRO, nunca um prefixo: os 8 primeiros
// digitos hex de um uuidv7 sao `ms >> 16`, um balde de ~65 segundos, entao os
// seedTenant da mesma rodada cairiam todos no mesmo slug e o segundo INSERT
// quebraria em tenant_slug_key (23505). Mesma razao ja documentada em
// membership.int.test.ts e session.int.test.ts.
async function seedTenant(nome: string): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES ($1, $2, $3, $4)`,
    [tenantId, `t-${tenantId}`, nome, '12ABC34501DE35'],
  );
  await jobsPool().query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES ($1, $2, $3, $4)`,
    [tenantId, clinicId, `${nome} - Unidade Centro`, 'America/Sao_Paulo'],
  );
  return { tenantId, clinicId };
}

async function seedMember(tenantId: string, clinicId: string, role: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  await jobsPool().query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, uuidv7(), userId, clinicId, role],
  );
  return userId;
}

describe('pnpm authz:seed', () => {
  it('a tabela ref.action espelha exatamente actions.ts, sem sobra nem falta', async () => {
    // Uma chave plantada a mao no banco tem que sumir no proximo seed: se o banco
    // pudesse ganhar acao propria, existiriam duas fontes da verdade.
    await jobsPool().query(
      `INSERT INTO ref.action (key, description, roles) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      ['fantasma.acao', 'inserida a mao', ['admin_clinico']],
    );

    pnpm('authz:seed');

    const { rows } = await jobsPool().query(`SELECT key FROM ref.action ORDER BY key`);
    const noBanco = rows.map((r) => r.key as string);
    expect(noBanco).toEqual([...ACTIONS.map((a) => a.key)].sort());
    expect(noBanco).not.toContain('fantasma.acao');
  });

  it('--check passa com o lock em dia', () => {
    expect(() => pnpm('authz:seed', '--check')).not.toThrow();
  });

  it('remove overrides órfãos ao aposentar uma ação do catálogo', async () => {
    const t = await seedTenant('Clínica de catálogo');
    const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      await admin.query(
        `INSERT INTO ref.action (key, description, roles)
         VALUES ('temporaria.remover', 'temporária', ARRAY['recepcao'])`,
      );
      await admin.query(
        `INSERT INTO app.permission_override
           (tenant_id, clinic_id, role, action_key, allowed)
         VALUES ($1, $2, 'recepcao', 'temporaria.remover', false)`,
        [t.tenantId, t.clinicId],
      );
      await admin.query(`DELETE FROM ref.action WHERE key = 'temporaria.remover'`);
      const { rows } = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM app.permission_override
          WHERE action_key = 'temporaria.remover'`,
      );
      expect(rows[0]?.count).toBe(0);
    } finally {
      await admin.end();
    }
  });
});

describe('authz decide a rota, RLS decide a linha', () => {
  it('rota permitida pelo authz continua devolvendo zero linhas do tenant alheio', async () => {
    const a = await seedTenant('Clinica A');
    const b = await seedTenant('Clinica B');
    const userId = await seedMember(a.tenantId, a.clinicId, 'admin_clinico');

    const sujeito: AuthzSubject = {
      userId, tenantId: a.tenantId,
      memberships: [{ clinicId: a.clinicId, role: 'admin_clinico' }],
      mfaAt: new Date(),
    };
    // O authz libera a rota...
    expect(can(sujeito, 'clinic.read', { clinicId: a.clinicId }).allowed).toBe(true);

    // ...e o RLS continua sendo quem decide a linha.
    const r = await withTenantTx(
      { kind: 'user', tenantId: a.tenantId, userId, clinicId: a.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.clinic WHERE id = $1`, [b.clinicId],
      ),
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('linha visivel pelo RLS nao basta: recepcao segue sem a acao de conceder vinculo', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedMember(t.tenantId, t.clinicId, 'recepcao');

    const r = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.clinic WHERE id = $1`, [t.clinicId],
      ),
    );
    expect(r.rows[0]?.n).toBe(1);   // o RLS deixa ver

    const d = can(
      { userId, tenantId: t.tenantId,
        memberships: [{ clinicId: t.clinicId, role: 'recepcao' }], mfaAt: new Date() },
      'membership.grant', { clinicId: t.clinicId },
    );
    expect(d.allowed).toBe(false);  // e o authz recusa a rota
    if (d.allowed) return;
    expect(d.reason).toBe('papel_insuficiente');
  });
});
