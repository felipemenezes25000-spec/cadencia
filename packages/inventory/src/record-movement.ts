import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type MovementFailure =
  | { kind: 'produto_nao_encontrado' }
  | { kind: 'quantidade_invalida' };

export type MovementKind = 'entrada' | 'saida' | 'ajuste' | 'perda';
export type ReferenceType = 'compra' | 'uso_atendimento' | 'ajuste_manual' | 'perda';

export interface RecordMovementInput {
  readonly productId: string;
  readonly kind: MovementKind;
  readonly quantity: number;
  readonly reason: string;
  readonly referenceType: ReferenceType;
  readonly referenceId?: string;
}

export interface RecordedMovement {
  readonly movementId: string;
  readonly productId: string;
  readonly newStock: number;
}

export async function recordMovement(
  tx: TxClient,
  i: RecordMovementInput,
  movedBy: string,
  clinicId: string,
): Promise<Result<RecordedMovement, MovementFailure>> {
  if (i.quantity <= 0) return err({ kind: 'quantidade_invalida' });

  const { rows: productRows } = await tx.query<{ id: string }>(
    `SELECT id FROM inv.product WHERE id = $1`, [i.productId]);
  if (productRows.length === 0) return err({ kind: 'produto_nao_encontrado' });

  const movementId = uuidv7();

  await tx.query(
    `INSERT INTO inv.stock_movement
       (id, product_id, kind, quantity, reason, reference_type, reference_id, moved_by)
     VALUES ($1, $2, $3::inv.movement_kind, $4, $5,
             $6::inv.reference_type, $7, $8)`,
    [movementId, i.productId, i.kind, i.quantity, i.reason,
     i.referenceType, i.referenceId ?? null, movedBy]);

  // Ler o current_stock atualizado pelo trigger
  const { rows: stockRows } = await tx.query<{ current_stock: string }>(
    `SELECT current_stock::text FROM inv.product WHERE id = $1`, [i.productId]);
  const newStock = Number(stockRows[0]!.current_stock);

  await tx.query(
    `SELECT audit.log('STOCK_MOVEMENT', 'inv', 'stock_movement', $1, 'sucesso',
                      jsonb_build_object('movement_kind', $2::text,
                                         'quantity', $3::text,
                                         'reference_type', $4::text,
                                         'current_stock', $5::text), $6)`,
    [movementId, i.kind, String(i.quantity), i.referenceType,
     String(newStock), clinicId]);

  return ok({ movementId, productId: i.productId, newStock });
}

export interface AdjustStockInput {
  readonly productId: string;
  readonly newQuantity: number;
  readonly reason: string;
}

/**
 * Ajuste de estoque: calcula a diferença entre estoque atual e o desejado,
 * e registra uma movimentação de ajuste (entrada ou saida) para chegar lá.
 */
export async function adjustStock(
  tx: TxClient,
  i: AdjustStockInput,
  movedBy: string,
  clinicId: string,
): Promise<Result<RecordedMovement, MovementFailure>> {
  const { rows: productRows } = await tx.query<{ id: string; current_stock: string }>(
    `SELECT id, current_stock::text FROM inv.product WHERE id = $1`, [i.productId]);
  if (productRows.length === 0) return err({ kind: 'produto_nao_encontrado' });

  const currentStock = Number(productRows[0]!.current_stock);
  const diff = i.newQuantity - currentStock;

  if (diff === 0) {
    return ok({ movementId: '', productId: i.productId, newStock: currentStock });
  }

  const kind: MovementKind = diff > 0 ? 'entrada' : 'saida';
  const quantity = Math.abs(diff);

  return recordMovement(tx, {
    productId: i.productId,
    kind,
    quantity,
    reason: i.reason,
    referenceType: 'ajuste_manual',
  }, movedBy, clinicId);
}
