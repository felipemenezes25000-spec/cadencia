// packages/db/test/0073_msg_channel_identity.int.test.ts
//
// Testes de integracao para msg.channel_identity (criada em 0071).
// Valida existencia da tabela, RLS multi-tenant, e constraint unique.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { closePools } from '../src/pool';
import { withTenantTx, type Actor } from '../src/tx';

// IDs fixos para este teste — UUIDv7 validos, nao colidem com o seed da iso.
const TENANT_A = '01930000-0000-7000-8000-100000000001';
const TENANT_B = '01930000-0000-7000-8000-100000000002';
const USER_A   = '01930000-0000-7000-8000-100000000003';
const CLINIC_A = '01930000-0000-7000-8000-100000000004';
const USER_B   = '01930000-0000-7000-8000-100000000005';
const CLINIC_B = '01930000-0000-7000-8000-100000000006';
const REQUEST  = '01930000-0000-7000-8000-100000000009';

const actorA: Actor = {
  kind: 'user',
  tenantId: TENANT_A,
  userId: USER_A,
  clinicId: CLINIC_A,
  requestId: REQUEST,
};

const actorB: Actor = {
  kind: 'user',
  tenantId: TENANT_B,
  userId: USER_B,
  clinicId: CLINIC_B,
  requestId: REQUEST,
};

let admin: Pool;
let businessPoolInstance: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({
    connectionString: process.env.DATABASE_URL_ADMIN,
    max: 1,
  });
  businessPoolInstance = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    application_name: 'cadencia-channel-identity-test',
  });

  // Semear dois tenants com usuario, clinica e vinculo para que app.is_member() passe.
  await admin.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
       ($1, 'ci-alpha', 'CI Alpha Ltda', '11AAA111111101'),
       ($2, 'ci-beta',  'CI Beta Ltda',  '22BBB222222202')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await admin.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
       ($1, $3, 'Alpha SP', '9990001', 'America/Sao_Paulo'),
       ($2, $4, 'Beta RJ',  '9990002', 'America/Sao_Paulo')
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [TENANT_A, TENANT_B, CLINIC_A, CLINIC_B],
  );
  await admin.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ci-user-a@test.local', 'User A'),
       ($2, 'ci-user-b@test.local', 'User B')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B],
  );
  await admin.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, gen_random_uuid(), $3, $5, 'admin_clinico'),
       ($2, gen_random_uuid(), $4, $6, 'admin_clinico')
     ON CONFLICT DO NOTHING`,
    [TENANT_A, TENANT_B, USER_A, USER_B, CLINIC_A, CLINIC_B],
  );
});

afterAll(async () => {
  // Limpar dados de teste na ordem correta de FKs.
  await admin.query('DELETE FROM msg.channel_identity WHERE tenant_id = ANY($1::uuid[])', [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query('DELETE FROM app.membership WHERE tenant_id = ANY($1::uuid[])', [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query('DELETE FROM app.clinic WHERE tenant_id = ANY($1::uuid[])', [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query('DELETE FROM app.professional WHERE tenant_id = ANY($1::uuid[])', [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query(`DELETE FROM id."user" WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]]);
  await admin.query('DELETE FROM app.tenant WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
  await admin.end();
  await businessPoolInstance.end();
  await closePools();
});

describe('msg.channel_identity', () => {
  it('a tabela msg.channel_identity existe no schema msg', async () => {
    const result = await admin.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'msg' AND table_name = 'channel_identity'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('insere identidade de canal com tenant_id e RLS permite leitura do mesmo tenant', async () => {
    await withTenantTx(actorA, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          waba_ref, provider_ref, status
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica Teste',
          '+5511987654321', 'waba-123', 'prov-ref-1', 'verified'
        )
      `, [TENANT_A]);

      const result = await tx.query(
        'SELECT channel, display_name, phone, status FROM msg.channel_identity WHERE tenant_id = $1',
        [TENANT_A],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        channel: 'whatsapp',
        display_name: 'Clinica Teste',
        phone: '+5511987654321',
        status: 'verified',
      });
    }, businessPoolInstance);
  });

  it('RLS impede leitura de canal de OUTRO tenant', async () => {
    // Inserir como admin para garantir que a linha persiste apos o teste anterior (que fez COMMIT).
    await admin.query(`
      INSERT INTO msg.channel_identity (
        tenant_id, id, channel, display_name, phone,
        provider_ref, status
      ) VALUES (
        $1, gen_random_uuid(), 'whatsapp', 'Outra Clinica',
        '+5511911111111', 'prov-ref-2', 'verified'
      )
    `, [TENANT_A]);

    // Actor B nao deve enxergar linhas do tenant A.
    await withTenantTx(actorB, async (tx) => {
      const result = await tx.query(
        'SELECT * FROM msg.channel_identity WHERE tenant_id = $1',
        [TENANT_A],
      );
      expect(result.rows).toHaveLength(0);
    }, businessPoolInstance);
  });

  it('constraint unique (tenant_id, channel, phone) impede duplicata', async () => {
    await withTenantTx(actorA, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A',
          '+5511922222222', 'prov-ref-3', 'verified'
        )
      `, [TENANT_A]);

      await expect(tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A Duplicada',
          '+5511922222222', 'prov-ref-4', 'verified'
        )
      `, [TENANT_A])).rejects.toThrow(/unique|duplicate/i);
    }, businessPoolInstance);
  });
});
