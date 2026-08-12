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

describe('com.cobranca', () => {
  const FATURA_ID   = uuidv7();
  const ASSINATURA_ID = uuidv7();

  it('tabela com.cobranca existe', async () => {
    const result = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'com' AND table_name = 'cobranca'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('cobranca pode ser criada com FK valida', async () => {
    // Cria fatura primeiro
    await adminPool.query(`
      INSERT INTO com.fatura (id, tenant_id, valor_cents, data_vencimento, status)
      VALUES ($1, $2, 14900, CURRENT_DATE + INTERVAL '7 days', 'pendente')
    `, [FATURA_ID, TENANT_ID]);

    const cobrancaId = uuidv7();
    const result = await adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, data_vencimento)
      VALUES ($1, $2, $3, $4, 14900, CURRENT_DATE + INTERVAL '7 days')
      RETURNING id, tenant_id, status, valor_original_cents
    `, [cobrancaId, TENANT_ID, ASSINATURA_ID, FATURA_ID]);

    expect(result.rows[0]).toMatchObject({
      id: cobrancaId,
      tenant_id: TENANT_ID,
      status: 'aberta',
      valor_original_cents: 14900,
    });
  });

  it('cobranca UNIQUE(tenant_id, fatura_id) impede duplicata por fatura', async () => {
    await expect(adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, data_vencimento)
      VALUES ($1, $2, $3, $4, 14900, CURRENT_DATE)
    `, [uuidv7(), TENANT_ID, ASSINATURA_ID, FATURA_ID])).rejects.toThrow(/unique|duplicate/i);
  });

  it('cobranca nao permite status invalido', async () => {
    const id = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, data_vencimento, status)
      VALUES ($1, $2, $3, $4, 14900, CURRENT_DATE, 'invalido')
    `, [id, TENANT_ID, ASSINATURA_ID, uuidv7()])).rejects.toThrow(/check/i);
  });

  it('cobranca requer fatura_id valido', async () => {
    const id = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, data_vencimento)
      VALUES ($1, $2, $3, '00000000-0000-0000-0000-999999999999', 14900, CURRENT_DATE)
    `, [id, TENANT_ID, ASSINATURA_ID])).rejects.toThrow(/foreign key/i);
  });

  it('cobranca pode receber valor com juros', async () => {
    const id = uuidv7();
    const result = await adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, valor_juros_cents, data_vencimento)
      VALUES ($1, $2, $3, $4, 14900, 500, CURRENT_DATE)
      RETURNING valor_original_cents, valor_juros_cents
    `, [id, TENANT_ID, ASSINATURA_ID, uuidv7()]);
    expect(result.rows[0]).toMatchObject({
      valor_original_cents: 14900,
      valor_juros_cents: 500,
    });
  });
});

describe('com.carne', () => {
  const COBRANCA_ID = uuidv7();

  beforeAll(async () => {
    // Cria cobranca para os testes de carne
    const faturaId = uuidv7();
    await adminPool.query(`
      INSERT INTO com.fatura (id, tenant_id, valor_cents, data_vencimento, status)
      VALUES ($1, $2, 44700, CURRENT_DATE + INTERVAL '30 days', 'pendente')
    `, [faturaId, TENANT_ID]);

    await adminPool.query(`
      INSERT INTO com.cobranca (id, tenant_id, assinatura_id, fatura_id, valor_original_cents, data_vencimento)
      VALUES ($1, $2, $3, $4, 44700, CURRENT_DATE + INTERVAL '30 days')
    `, [COBRANCA_ID, TENANT_ID, '00000000-0000-0000-0000-000000000001', faturaId]);
  });

  it('tabela com.carne existe', async () => {
    const result = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'com' AND table_name = 'carne'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('carne pode ser criado com FK valida', async () => {
    const carneId = uuidv7();
    const result = await adminPool.query(`
      INSERT INTO com.carne (id, tenant_id, cobranca_id, numero_parcela, valor_parcela_cents, data_vencimento)
      VALUES ($1, $2, $3, 1, 14900, CURRENT_DATE + INTERVAL '30 days')
      RETURNING id, tenant_id, numero_parcela, valor_parcela_cents, status
    `, [carneId, TENANT_ID, COBRANCA_ID]);

    expect(result.rows[0]).toMatchObject({
      id: carneId,
      tenant_id: TENANT_ID,
      numero_parcela: 1,
      valor_parcela_cents: 14900,
      status: 'aberta',
    });
  });

  it('carne UNIQUE(tenant_id, cobranca_id, numero_parcela) impede duplicata', async () => {
    await expect(adminPool.query(`
      INSERT INTO com.carne (id, tenant_id, cobranca_id, numero_parcela, valor_parcela_cents, data_vencimento)
      VALUES ($1, $2, $3, 1, 14900, CURRENT_DATE)
    `, [uuidv7(), TENANT_ID, COBRANCA_ID])).rejects.toThrow(/unique|duplicate/i);
  });

  it('carne nao permite status invalido', async () => {
    const id = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.carne (id, tenant_id, cobranca_id, numero_parcela, valor_parcela_cents, data_vencimento, status)
      VALUES ($1, $2, $3, 2, 14900, CURRENT_DATE, 'invalido')
    `, [id, TENANT_ID, COBRANCA_ID])).rejects.toThrow(/check/i);
  });

  it('carne numero_parcela >= 1', async () => {
    const id = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.carne (id, tenant_id, cobranca_id, numero_parcela, valor_parcela_cents, data_vencimento)
      VALUES ($1, $2, $3, 0, 14900, CURRENT_DATE)
    `, [id, TENANT_ID, COBRANCA_ID])).rejects.toThrow(/check/i);
  });
});

describe('com.suspensao', () => {
  it('tabela com.suspensao existe', async () => {
    const result = await adminPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'com' AND table_name = 'suspensao'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('suspensao pode ser criada por inadimplencia', async () => {
    const suspensaoId = uuidv7();
    const result = await adminPool.query(`
      INSERT INTO com.suspensao (id, tenant_id, assinatura_id, motivo, motivo_detalhe)
      VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'inadimplencia', '3 mensalidades atrasadas')
      RETURNING id, tenant_id, motivo, motivo_detalhe, data_fim
    `, [suspensaoId, TENANT_ID]);

    expect(result.rows[0]).toMatchObject({
      id: suspensaoId,
      tenant_id: TENANT_ID,
      motivo: 'inadimplencia',
      motivo_detalhe: '3 mensalidades atrasadas',
      data_fim: null,
    });
  });

  it('suspensao nao permite motivo invalido', async () => {
    const id = uuidv7();
    await expect(adminPool.query(`
      INSERT INTO com.suspensao (id, tenant_id, assinatura_id, motivo)
      VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'invalido')
    `, [id, TENANT_ID])).rejects.toThrow(/check/i);
  });

  it('suspensao pode ser marcada como restaurada', async () => {
    const suspensaoId = uuidv7();
    const now = new Date();
    await adminPool.query(`
      INSERT INTO com.suspensao (id, tenant_id, assinatura_id, motivo)
      VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'inadimplencia')
    `, [suspensaoId, TENANT_ID]);

    const result = await adminPool.query(`
      UPDATE com.suspensao SET data_fim = $1, restaurada_em = $1
      WHERE id = $2
      RETURNING data_fim, restaurada_em
    `, [now, suspensaoId]);

    expect(result.rows[0].data_fim).not.toBeNull();
    expect(result.rows[0].restaurada_em).not.toBeNull();
  });

  it('jobs tem privilegio SELECT em com.cobranca', async () => {
    const result = await jobsPool().query(
      `SELECT has_table_privilege('jobs', 'com.cobranca', 'SELECT') AS has`
    );
    expect(result.rows[0]?.has).toBe(true);
  });

  it('jobs tem privilegio SELECT em com.carne', async () => {
    const result = await jobsPool().query(
      `SELECT has_table_privilege('jobs', 'com.carne', 'SELECT') AS has`
    );
    expect(result.rows[0]?.has).toBe(true);
  });

  it('jobs tem privilegio SELECT em com.suspensao', async () => {
    const result = await jobsPool().query(
      `SELECT has_table_privilege('jobs', 'com.suspensao', 'SELECT') AS has`
    );
    expect(result.rows[0]?.has).toBe(true);
  });
});
