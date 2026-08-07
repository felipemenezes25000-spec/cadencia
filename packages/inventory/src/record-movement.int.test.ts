import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordMovement, adjustStock } from './record-movement';
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

describe('recordMovement — registra movimentacao de estoque', () => {
  it('registra entrada e atualiza current_stock via trigger', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 100,
        reason: 'Compra mensal',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(100);
  });

  it('registra saida e decrementa current_stock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'saida',
        quantity: 15,
        reason: 'Uso em atendimento',
        referenceType: 'uso_atendimento',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(85);
  });

  it('registra perda e decrementa current_stock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'perda',
        quantity: 5,
        reason: 'Vencido',
        referenceType: 'perda',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(80);
  });

  it('rejeita produto inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: uuidv7(),
        kind: 'entrada',
        quantity: 10,
        reason: 'Teste',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('produto_nao_encontrado');
  });

  it('rejeita quantidade zero ou negativa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 0,
        reason: 'Invalido',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('quantidade_invalida');
  });

  it('grava evento de auditoria STOCK_MOVEMENT', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordMovement(tx, {
        productId: s.productId,
        kind: 'entrada',
        quantity: 10,
        reason: 'Reposicao para auditoria',
        referenceType: 'compra',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, async (tx) => {
      return tx.query<{ event_type: string; entity_id: string }>(
        `SELECT event_type, entity_id::text
           FROM audit.event
          WHERE entity_id = $1 AND event_type = 'STOCK_MOVEMENT'`,
        [r.value.movementId]);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('STOCK_MOVEMENT');
  });
});

describe('adjustStock — ajusta estoque para quantidade desejada', () => {
  it('ajusta para cima quando newQuantity > currentStock', async () => {
    // current_stock apos testes acima: 80 + 10 = 90
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 100,
        reason: 'Recontagem de inventario',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(100);
  });

  it('ajusta para baixo quando newQuantity < currentStock', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 50,
        reason: 'Recontagem com falta',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.newStock).toBe(50);
  });

  it('nao cria movimentacao quando diferenca e zero', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: s.productId,
        newQuantity: 50,
        reason: 'Sem mudanca',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.movementId).toBe('');
    expect(r.value.newStock).toBe(50);
  });

  it('rejeita produto inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      adjustStock(tx, {
        productId: uuidv7(),
        newQuantity: 10,
        reason: 'Inexistente',
      }, s.userId, s.clinicId));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('produto_nao_encontrado');
  });
});
