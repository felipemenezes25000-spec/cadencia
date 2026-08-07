import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { runStockAlertJob } from './stock-alert-job';

let jobsPool: Pool;
let admin: Pool;
let tenantId: string;
let clinicId: string;
let userId: string;
let productBelowId: string;
let productAboveId: string;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} ausente`);
  return v;
}

beforeAll(async () => {
  jobsPool = new Pool({ connectionString: requireEnv('DATABASE_URL_JOBS'), max: 2 });
  admin = new Pool({ connectionString: requireEnv('DATABASE_URL_ADMIN'), max: 1 });

  tenantId = uuidv7();
  clinicId = uuidv7();
  userId = uuidv7();
  productBelowId = uuidv7();
  productAboveId = uuidv7();

  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica AlertJob', '77ABC88901DE00')`,
      [tenantId, `aj-${tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade AJ', '7777771', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Job User')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [tenantId, userId, clinicId]);

    // Produto ABAIXO do minimo (current_stock=5, min_stock=20)
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, current_stock)
       VALUES ($1, $2, 'Seringa 5ml', 'un', 20, 5)`,
      [tenantId, productBelowId]);

    // Produto ACIMA do minimo (current_stock=50, min_stock=10)
    await c.query(
      `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock, current_stock)
       VALUES ($1, $2, 'Algodao 500g', 'un', 10, 50)`,
      [tenantId, productAboveId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await jobsPool.end();
  await admin.end();
});

describe('runStockAlertJob — job diario de alerta de estoque', () => {
  it('cria alerta para produto abaixo do minimo', async () => {
    const result = await runStockAlertJob(jobsPool);

    expect(result.created).toBeGreaterThanOrEqual(1);

    const { rows } = await admin.query<{ product_id: string; resolved_at: string | null }>(
      `SELECT product_id::text, resolved_at
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2 AND resolved_at IS NULL`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolved_at).toBeNull();
  });

  it('nao cria alerta duplicado na segunda execucao', async () => {
    await runStockAlertJob(jobsPool);

    // Nenhum novo alerta deve ser criado para o mesmo produto
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2 AND resolved_at IS NULL`,
      [tenantId, productBelowId]);

    expect(Number(rows[0]!.cnt)).toBe(1);
  });

  it('nao cria alerta para produto acima do minimo', async () => {
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2`,
      [tenantId, productAboveId]);

    expect(Number(rows[0]!.cnt)).toBe(0);
  });

  it('resolve alerta quando produto volta acima do minimo', async () => {
    // Subir o estoque do produto para acima do minimo
    const c = await admin.connect();
    try {
      await c.query(
        `UPDATE inv.product SET current_stock = 25 WHERE id = $1`,
        [productBelowId]);
    } finally {
      c.release();
    }

    const result = await runStockAlertJob(jobsPool);
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    const { rows } = await admin.query<{ resolved_at: string | null }>(
      `SELECT resolved_at::text
         FROM inv.stock_alert
        WHERE tenant_id = $1 AND product_id = $2
        ORDER BY triggered_at DESC LIMIT 1`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolved_at).not.toBeNull();
  });

  it('enfileira evento STOCK_ALERT_TRIGGERED no outbox para alertas novos', async () => {
    // Baixar estoque de volta para disparar novo alerta
    const c = await admin.connect();
    try {
      await c.query(
        `UPDATE inv.product SET current_stock = 3 WHERE id = $1`,
        [productBelowId]);
    } finally {
      c.release();
    }

    await runStockAlertJob(jobsPool);

    const { rows } = await admin.query<{ event_type: string; aggregate_id: string }>(
      `SELECT event_type, aggregate_id::text
         FROM app.outbox
        WHERE tenant_id = $1 AND event_type = 'STOCK_ALERT_TRIGGERED' AND aggregate_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, productBelowId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('STOCK_ALERT_TRIGGERED');
  });
});
