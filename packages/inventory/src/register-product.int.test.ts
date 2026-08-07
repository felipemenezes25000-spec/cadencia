import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { registerProduct } from './register-product';
import { semearEstoque, type SementeEstoque } from './test-support';

let s: SementeEstoque;
let actor: Actor;

beforeAll(async () => {
  s = await semearEstoque();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('registerProduct — cadastro de produto no estoque', () => {
  it('cadastra produto com fornecedor', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Luva descartavel M',
        sku: 'LUV-M-001',
        unit: 'cx',
        minStock: 10,
        costPriceCents: 2500,
        salePriceCents: 5000,
        supplierId: s.supplierId,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Luva descartavel M');
    expect(r.value.currentStock).toBe(0);
  });

  it('cadastra produto sem fornecedor e sem SKU', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Algodao 500g',
        unit: 'un',
        minStock: 5,
        costPriceCents: 800,
        salePriceCents: 1500,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Algodao 500g');
  });

  it('rejeita fornecedor inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto X',
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
        supplierId: uuidv7(),
      }, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('fornecedor_nao_encontrado');
  });

  it('rejeita SKU duplicado entre produtos ativos', async () => {
    const sku = `DUP-${uuidv7().slice(0, 8)}`;
    await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto Original',
        sku,
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
      }, s.clinicId));

    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Produto Duplicado',
        sku,
        unit: 'un',
        minStock: 0,
        costPriceCents: 100,
        salePriceCents: 200,
      }, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('sku_duplicado');
  });

  it('grava evento de auditoria PRODUCT_REGISTER', async () => {
    const r = await withTenantTx(actor, (tx) =>
      registerProduct(tx, {
        name: 'Esparadrapo micropore',
        sku: `AUD-${uuidv7().slice(0, 8)}`,
        unit: 'un',
        minStock: 3,
        costPriceCents: 350,
        salePriceCents: 700,
      }, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, async (tx) => {
      return tx.query<{ event_type: string; entity_id: string }>(
        `SELECT event_type, entity_id::text
           FROM audit.event
          WHERE entity_id = $1 AND event_type = 'PRODUCT_REGISTER'`,
        [r.value.productId]);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('PRODUCT_REGISTER');
  });
});
