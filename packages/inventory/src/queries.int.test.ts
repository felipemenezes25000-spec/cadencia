import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { recordMovement } from './record-movement';
import { getStockAlerts, getMovementHistory } from './queries';
import { semearEstoque, type SementeEstoque } from './test-support';

let s: SementeEstoque;
let actor: Actor;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  s = await semearEstoque();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear movimentacoes para historico
  await withTenantTx(actor, (tx) =>
    recordMovement(tx, {
      productId: s.productId,
      kind: 'entrada',
      quantity: 100,
      reason: 'Compra inicial',
      referenceType: 'compra',
    }, s.userId, s.clinicId));

  await withTenantTx(actor, (tx) =>
    recordMovement(tx, {
      productId: s.productId,
      kind: 'saida',
      quantity: 30,
      reason: 'Uso em atendimento',
      referenceType: 'uso_atendimento',
    }, s.userId, s.clinicId));

  // Semear alerta manualmente via admin (simula o job)
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query(
      `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold)
       VALUES ($1, gen_random_uuid(), $2, 20)`,
      [s.tenantId, s.productId]);
  } finally {
    c.release();
    await admin.end();
  }
});
afterAll(async () => { await closePools(); });

describe('getStockAlerts — lista alertas de estoque abertos', () => {
  it('retorna alertas nao resolvidos', async () => {
    const alerts = await withTenantTx(actor, (tx) => getStockAlerts(tx));

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const alert = alerts.find((a) => a.productId === s.productId);
    expect(alert).toBeDefined();
    expect(alert!.productName).toBe('Gaze esteril 10x10');
    expect(alert!.threshold).toBe(20);
    expect(alert!.currentStock).toBe(70);
  });

  it('nao retorna alertas resolvidos', async () => {
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const resolvedProductId = uuidv7();
    try {
      await c.query(
        `INSERT INTO inv.product (tenant_id, id, name, unit, min_stock)
         VALUES ($1, $2, 'Produto Resolvido', 'un', 5)`,
        [s.tenantId, resolvedProductId]);
      await c.query(
        `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold, resolved_at)
         VALUES ($1, gen_random_uuid(), $2, 5, clock_timestamp())`,
        [s.tenantId, resolvedProductId]);
    } finally {
      c.release();
      await admin.end();
    }

    const alerts = await withTenantTx(actor, (tx) => getStockAlerts(tx));
    const resolved = alerts.find((a) => a.productId === resolvedProductId);
    expect(resolved).toBeUndefined();
  });
});

describe('getMovementHistory — historico de movimentacoes', () => {
  it('retorna historico ordenado por data decrescente', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx));

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    // O mais recente (saida) vem primeiro
    expect(result.rows[0]!.kind).toBe('saida');
    expect(result.rows[0]!.quantity).toBe(30);
  });

  it('filtra por productId', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId }));

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of result.rows) {
      expect(row.productId).toBe(s.productId);
    }
  });

  it('pagina com cursor', async () => {
    const page1 = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId, limit: 1 }));

    expect(page1.rows).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, {
        productId: s.productId,
        limit: 1,
        cursor: page1.nextCursor!,
      }));

    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]!.movementId).not.toBe(page1.rows[0]!.movementId);
  });

  it('retorna nextCursor null quando nao ha mais paginas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      getMovementHistory(tx, { productId: s.productId, limit: 100 }));

    expect(result.nextCursor).toBeNull();
  });
});
