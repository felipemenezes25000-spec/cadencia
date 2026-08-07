import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type ProductFailure =
  | { kind: 'fornecedor_nao_encontrado' }
  | { kind: 'sku_duplicado'; sku: string };

export interface RegisterProductInput {
  readonly name: string;
  readonly sku?: string;
  readonly unit: 'un' | 'cx' | 'ml' | 'g' | 'kg';
  readonly minStock: number;
  readonly costPriceCents: number;
  readonly salePriceCents: number;
  readonly supplierId?: string;
}

export interface RegisteredProduct {
  readonly productId: string;
  readonly name: string;
  readonly currentStock: number;
}

export async function registerProduct(
  tx: TxClient,
  i: RegisterProductInput,
  clinicId: string,
): Promise<Result<RegisteredProduct, ProductFailure>> {
  if (i.supplierId !== undefined) {
    const { rows: supplierRows } = await tx.query<{ id: string }>(
      `SELECT id FROM inv.supplier WHERE id = $1`, [i.supplierId]);
    if (supplierRows.length === 0) return err({ kind: 'fornecedor_nao_encontrado' });
  }

  const productId = uuidv7();

  try {
    await tx.query(
      `INSERT INTO inv.product
         (id, name, sku, unit, min_stock, cost_price_cents, sale_price_cents, supplier_id)
       VALUES ($1, $2, $3, $4::inv.unit_kind, $5, $6, $7, $8)`,
      [productId, i.name, i.sku ?? null, i.unit, i.minStock,
       i.costPriceCents, i.salePriceCents, i.supplierId ?? null]);
  } catch (e: unknown) {
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && i.sku !== undefined) {
      return err({ kind: 'sku_duplicado', sku: i.sku });
    }
    throw e;
  }

  await tx.query(
    `SELECT audit.log('PRODUCT_REGISTER', 'inv', 'product', $1, 'sucesso',
                      jsonb_build_object('product_name', $2::text,
                                         'sku', COALESCE($3::text, ''),
                                         'quantity', '0'), $4)`,
    [productId, i.name, i.sku ?? null, clinicId]);

  return ok({ productId, name: i.name, currentStock: 0 });
}
