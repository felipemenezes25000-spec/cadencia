import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';
import { MEMBERSHIP_ROLES, resolveMemberships } from './membership';

// O slug e o email levam o uuid INTEIRO, nunca um prefixo. Os 12 primeiros
// digitos hex de um uuidv7 sao o timestamp em milissegundos: os 8 primeiros sao
// `ms >> 16`, um balde de ~65 segundos, entao TODOS os seedTenant da mesma
// rodada cairiam no mesmo slug e o segundo INSERT quebraria em tenant_slug_key
// (23505). Mesma razao ja documentada em session.int.test.ts.
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

async function seedUser(fullName: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId}@exemplo.com.br`, fullName],
  );
  return userId;
}

async function grant(
  tenantId: string, clinicId: string, userId: string, role: string,
): Promise<string> {
  const id = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, id, userId, clinicId, role],
  );
  return id;
}

describe('resolveMemberships', () => {
  it('dentro do tenant A o vinculo do mesmo medico no tenant B nao aparece', async () => {
    const a = await seedTenant('Clinica Sao Paulo');
    const b = await seedTenant('Clinica Manaus');
    const userId = await seedUser('Dra. Ana Ribeiro');
    await grant(a.tenantId, a.clinicId, userId, 'admin_clinico');
    await grant(b.tenantId, b.clinicId, userId, 'recepcao');

    const vinculos = await withTenantTx(
      { kind: 'user', tenantId: a.tenantId, userId, clinicId: a.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(vinculos).toEqual([
      { tenantId: a.tenantId, clinicId: a.clinicId, role: 'admin_clinico' },
    ]);
  });

  it('vinculo revogado some da lista na requisicao seguinte', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedUser('Dr. Bruno Camargo');
    const membershipId = await grant(t.tenantId, t.clinicId, userId, 'profissional');

    const antes = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(antes).toHaveLength(1);

    await jobsPool().query(
      `UPDATE app.membership
          SET revoked_at = clock_timestamp(), revoked_reason = $2
        WHERE id = $1`,
      [membershipId, 'desligamento'],
    );

    const depois = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(depois).toEqual([]);
  });

  it('dois papeis na mesma unidade devolvem duas linhas, nao um papel escalar', async () => {
    const t = await seedTenant('Clinica Integrada');
    const userId = await seedUser('Dra. Carla Nunes');
    await grant(t.tenantId, t.clinicId, userId, 'profissional');
    await grant(t.tenantId, t.clinicId, userId, 'financeiro');

    const vinculos = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(vinculos.map((v) => v.role).sort()).toEqual(['financeiro', 'profissional']);
  });

  it('a lista de papeis do TypeScript e exatamente a do CHECK de app.membership', async () => {
    const { rows } = await jobsPool().query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'app.membership'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%role%'`,
    );
    const def = rows.map((r) => r.def as string).join(' ');
    const noBanco = (def.match(/'[a-z_]+'/g) ?? []).map((s) => s.slice(1, -1)).sort();
    expect(noBanco).toEqual([...MEMBERSHIP_ROLES].sort());
  });
});
