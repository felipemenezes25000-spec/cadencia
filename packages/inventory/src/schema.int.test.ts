import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(() => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('schema inv — tabelas de estoque existem', () => {
  it('inv.supplier existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'supplier'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.product existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'product'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.stock_movement existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_movement'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('inv.stock_alert existe com RLS forcado', async () => {
    const { rows } = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_alert'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('trigger inv_update_current_stock existe em stock_movement', async () => {
    const { rows } = await admin.query<{ tgname: string }>(
      `SELECT t.tgname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'stock_movement'
          AND t.tgname = 'trg_update_current_stock'`);
    expect(rows).toHaveLength(1);
  });

  it('current_stock e derivado: trigger recalcula soma apos INSERT', async () => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');

      const tenantId = '019145a0-0000-7000-8000-000000000001';
      const clinicId = '019145a0-0000-7000-8000-000000000002';
      const userId   = '019145a0-0000-7000-8000-000000000003';
      const productId = '019145a0-0000-7000-8000-000000000010';

      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'inv-test', 'Clinica Estoque', '11ABC22301DE44')`,
        [tenantId]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Unidade Inv', '9999991', 'America/Sao_Paulo')`,
        [tenantId, clinicId]);
      await c.query(
        `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Inv Tester')`,
        [userId, 'inv-test@example.test']);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [tenantId, userId, clinicId]);

      await c.query(
        `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock)
         VALUES ($1, $2, 'Gaze esteril', 'un', 10)`,
        [tenantId, productId]);

      // Inserir movimento de entrada: 50 unidades
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'entrada', 50, 'Compra inicial', 'compra', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterEntry } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterEntry[0]!.current_stock)).toBe(50);

      // Inserir movimento de saida: 15 unidades
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'saida', 15, 'Uso em atendimento', 'uso_atendimento', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterExit } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterExit[0]!.current_stock)).toBe(35);

      // Inserir ajuste: +5
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'ajuste', 5, 'Recontagem', 'ajuste_manual', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterAdjust } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterAdjust[0]!.current_stock)).toBe(40);

      // Inserir perda: 2
      await c.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason, reference_type, moved_by)
         VALUES ($1, gen_random_uuid(), $2, 'perda', 2, 'Danificado', 'perda', $3)`,
        [tenantId, productId, userId]);

      const { rows: afterLoss } = await c.query<{ current_stock: string }>(
        `SELECT current_stock::text FROM inv.product WHERE id = $1`, [productId]);
      expect(Number(afterLoss[0]!.current_stock)).toBe(38);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
