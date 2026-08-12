// packages/billing/src/schema.int.test.ts
//
// Testes de integração para o schema com (comercial).
// Valida existência do schema, tabelas, seed de planos e constraints.
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

const TENANT_ID = '01940000-0000-7000-8000-100000000001';
const USER_ID    = '01940000-0000-7000-8000-100000000002';
const PLANO_BASICO_ID      = '00000000-0000-0000-0000-000000000001';
const PLANO_PROFISSIONAL_ID = '00000000-0000-0000-0000-000000000002';

let adminPool: Pool;

beforeAll(async () => {
  await runMigrations();
  adminPool = new Pool({
    connectionString: process.env.DATABASE_URL_ADMIN,
    max: 1,
  });

  // Seed tenant para os testes
  await adminPool.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
       ($1, 'billing-test', 'Billing Test Ltda', '99BBB99999BC99')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID],
  );
  await adminPool.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'billing-test@test.local', 'Billing Test User')
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID],
  );
});

afterAll(async () => {
  await adminPool.query('DELETE FROM com.assinatura WHERE tenant_id = $1', [TENANT_ID]);
  await adminPool.query('DELETE FROM fin.bank_account WHERE tenant_id = $1', [TENANT_ID]);
  await adminPool.query('DELETE FROM app.tenant WHERE id = $1', [TENANT_ID]);
  await adminPool.query(`DELETE FROM id."user" WHERE id = $1`, [USER_ID]);
  await adminPool.end();
  await closePools();
});

// Limpa assinaturas entre testes para evitar conflito de UNIQUE(tenant_id)
afterEach(async () => {
  await adminPool.query('DELETE FROM com.assinatura WHERE tenant_id = $1', [TENANT_ID]);
});

describe('com schema', () => {
  it('schema com existe', async () => {
    const result = await adminPool.query(`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = 'com'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('tabela com.plano existe', async () => {
    const result = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'com' AND table_name = 'plano'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('tabela com.assinatura existe', async () => {
    const result = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'com' AND table_name = 'assinatura'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('planos seed estao presentes', async () => {
    const result = await adminPool.query(`
      SELECT slug, nome, valor_por_profissional_cents, periodicidade, features
      FROM com.plano
      WHERE slug IN ('basico', 'profissional', 'enterprise')
      ORDER BY slug
    `);
    expect(result.rows).toHaveLength(3);
    // ORDER BY slug: basico, enterprise, profissional
    expect(result.rows[0]).toMatchObject({
      slug: 'basico',
      nome: 'Básico',
      valor_por_profissional_cents: 8900,
      periodicidade: 'mensal',
    });
    expect(result.rows[1]).toMatchObject({
      slug: 'enterprise',
      nome: 'Enterprise',
      valor_por_profissional_cents: 24900,
      periodicidade: 'mensal',
    });
    expect(result.rows[2]).toMatchObject({
      slug: 'profissional',
      nome: 'Profissional',
      valor_por_profissional_cents: 14900,
      periodicidade: 'mensal',
    });
  });

  it('assinatura pode ser criada com tenant valido', async () => {
    const assinaturaId = uuidv7();
    const result = await adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, $2, $3, 'trial')
      RETURNING id, tenant_id, plano_id, status
    `, [assinaturaId, TENANT_ID, PLANO_BASICO_ID]);
    expect(result.rows[0]).toMatchObject({
      id: assinaturaId,
      tenant_id: TENANT_ID,
      plano_id: PLANO_BASICO_ID,
      status: 'trial',
    });
  });

  it('assinatura UNIQUE(tenant_id) impede dois planos para mesmo tenant', async () => {
    // Cria primeira assinatura
    await adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, $2, $3, 'trial')
    `, [uuidv7(), TENANT_ID, PLANO_BASICO_ID]);
    // Tenta criar segunda assinatura com mesmo tenant_id - deve falhar
    await expect(adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, $2, $3, 'trial')
    `, [uuidv7(), TENANT_ID, PLANO_PROFISSIONAL_ID])).rejects.toThrow(/unique|duplicate/i);
  });

  it('assinatura nao permite status invalido', async () => {
    const assinaturaId = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, $2, $3, 'invalido')
    `, [assinaturaId, TENANT_ID, PLANO_BASICO_ID])).rejects.toThrow(/check/i);
  });

  it('plano slug UNIQUE impede duplicata', async () => {
    await expect(adminPool.query(`
      INSERT INTO com.plano (id, slug, nome, valor_por_profissional_cents, periodicidade)
      VALUES ($1, 'basico', 'Outro Basico', 9999, 'mensal')
    `, [uuidv7()])).rejects.toThrow(/unique|duplicate/i);
  });

  it('assinatura requer plano_id valido', async () => {
    const assinaturaId = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, $2, '00000000-0000-0000-0000-999999999999', 'trial')
    `, [assinaturaId, TENANT_ID])).rejects.toThrow(/foreign key/i);
  });

  it('assinatura requer tenant_id valido', async () => {
    const assinaturaId = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.assinatura (id, tenant_id, plano_id, status)
      VALUES ($1, '00000000-0000-0000-0000-999999999999', $2, 'trial')
    `, [assinaturaId, PLANO_BASICO_ID])).rejects.toThrow(/foreign key/i);
  });

  it('jobs tem privilegio SELECT em com.plano', async () => {
    const result = await jobsPool().query(
      `SELECT has_table_privilege('jobs', 'com.plano', 'SELECT') AS has`
    );
    expect(result.rows[0]?.has).toBe(true);
  });

  it('jobs tem privilegio SELECT em com.assinatura', async () => {
    const result = await jobsPool().query(
      `SELECT has_table_privilege('jobs', 'com.assinatura', 'SELECT') AS has`
    );
    expect(result.rows[0]?.has).toBe(true);
  });
});
