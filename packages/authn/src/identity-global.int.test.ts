import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';

// jobsPool usa o papel `jobs`, o unico do cluster com BYPASSRLS. Serve APENAS
// para montar cenario; toda asserticao roda por withTenantTx, sujeita a RLS.
async function seedTenant(nome: string): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  // Slug e email levam o uuid INTEIRO, nunca um prefixo. Os 8 primeiros digitos
  // hex de um uuidv7 sao os bits altos do timestamp: eles so mudam a cada ~65s,
  // entao todo seedTenant da mesma rodada geraria o mesmo slug e o segundo
  // INSERT quebraria em tenant_slug_key (23505). Mesma razao no email, que e
  // UNIQUE em id."user" — la o prefixo colidiria ate entre rodadas.
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

describe('identidade global x vinculo por tenant', () => {
  it('id.user nao tem coluna tenant_id: a credencial do medico e unica, nao por clinica', async () => {
    const { rows } = await jobsPool().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'id' AND table_name = 'user'`,
    );
    const colunas = rows.map((r) => r.column_name as string);
    expect(colunas).toContain('id');
    expect(colunas).toContain('email');
    expect(colunas).toContain('cpf');
    expect(colunas).toContain('status');
    expect(colunas).not.toContain('tenant_id');
  });

  it('a credencial mora fora do tenant: id.user_credential tambem nao tem tenant_id', async () => {
    const { rows } = await jobsPool().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'id' AND table_name = 'user_credential'`,
    );
    const colunas = rows.map((r) => r.column_name as string);
    expect(colunas).toContain('password_hash');
    expect(colunas).toContain('locked_until');
    expect(colunas).not.toContain('tenant_id');
  });

  it('o mesmo medico e admin em uma rede e recepcao em outra, sem duplicar identidade', async () => {
    const sp = await seedTenant('Clinica Sao Paulo');
    const manaus = await seedTenant('Clinica Manaus');
    const userId = await seedUser('Dra. Ana Ribeiro');
    await grant(sp.tenantId, sp.clinicId, userId, 'admin_clinico');
    await grant(manaus.tenantId, manaus.clinicId, userId, 'recepcao');

    const emSp = await withTenantTx(
      { kind: 'user', tenantId: sp.tenantId, userId, clinicId: sp.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ pode: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS pode`, [sp.clinicId],
      ),
    );
    expect(emSp.rows[0]?.pode).toBe(true);

    const emManaus = await withTenantTx(
      { kind: 'user', tenantId: manaus.tenantId, userId, clinicId: manaus.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ pode: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS pode`, [manaus.clinicId],
      ),
    );
    expect(emManaus.rows[0]?.pode).toBe(false);
  });

  it('vinculo revogado para de valer imediatamente, e o motivo fica registrado', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedUser('Dr. Bruno Camargo');
    const membershipId = await grant(t.tenantId, t.clinicId, userId, 'profissional');

    const antes = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ membro: boolean }>(`SELECT app.is_member() AS membro`),
    );
    expect(antes.rows[0]?.membro).toBe(true);

    await jobsPool().query(
      `UPDATE app.membership
          SET revoked_at = clock_timestamp(), revoked_reason = $2
        WHERE id = $1`,
      [membershipId, 'desligamento'],
    );

    const depois = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ membro: boolean }>(`SELECT app.is_member() AS membro`),
    );
    expect(depois.rows[0]?.membro).toBe(false);
  });

  it('o vinculo do tenant A e invisivel dentro do contexto do tenant B', async () => {
    const a = await seedTenant('Clinica A');
    const b = await seedTenant('Clinica B');
    const userId = await seedUser('Dra. Carla Nunes');
    await grant(a.tenantId, a.clinicId, userId, 'admin_clinico');
    await grant(b.tenantId, b.clinicId, userId, 'admin_clinico');

    const vistoDeB = await withTenantTx(
      { kind: 'user', tenantId: b.tenantId, userId, clinicId: b.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.membership WHERE tenant_id = $1`, [a.tenantId],
      ),
    );
    expect(vistoDeB.rows[0]?.n).toBe(0);

    // E o pool de jobs, que e o unico com BYPASSRLS, enxerga os dois. E por isso
    // que ele monta cenario e NUNCA serve caminho de requisicao.
    const doJobs = await jobsPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.membership WHERE user_id = $1`, [userId],
    );
    expect(Number(doJobs.rows[0]?.n)).toBe(2);
  });
});
