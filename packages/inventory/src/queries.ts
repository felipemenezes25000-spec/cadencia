import type { TxClient } from '@cadencia/db';

export interface StockAlert {
  readonly alertId: string;
  readonly productId: string;
  readonly productName: string;
  readonly currentStock: number;
  readonly threshold: number;
  readonly triggeredAt: string;
}

/**
 * Retorna alertas de estoque abertos (resolved_at IS NULL) para o tenant.
 * Junta com inv.product para trazer nome e estoque atual.
 */
export async function getStockAlerts(
  tx: TxClient,
): Promise<StockAlert[]> {
  const { rows } = await tx.query<{
    alert_id: string; product_id: string; product_name: string;
    current_stock: string; threshold: string; triggered_at: string;
  }>(
    `SELECT a.id AS alert_id, a.product_id,
            p.name AS product_name,
            p.current_stock::text,
            a.threshold::text,
            to_char(a.triggered_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS triggered_at
       FROM inv.stock_alert a
       JOIN inv.product p
         ON p.tenant_id = a.tenant_id AND p.id = a.product_id
      WHERE a.resolved_at IS NULL
      ORDER BY a.triggered_at DESC`);

  return rows.map((r) => ({
    alertId: r.alert_id,
    productId: r.product_id,
    productName: r.product_name,
    currentStock: Number(r.current_stock),
    threshold: Number(r.threshold),
    triggeredAt: r.triggered_at,
  }));
}

export interface MovementHistoryRow {
  readonly movementId: string;
  readonly productId: string;
  readonly productName: string;
  readonly kind: string;
  readonly quantity: number;
  readonly reason: string;
  readonly referenceType: string;
  readonly referenceId: string | null;
  readonly movedAt: string;
  readonly movedBy: string;
}

export interface MovementHistoryInput {
  readonly productId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Histórico de movimentações com paginação por cursor (moved_at DESC).
 * Filtrável por produto. Traz o nome do produto junto.
 */
export async function getMovementHistory(
  tx: TxClient,
  i: MovementHistoryInput = {},
): Promise<{ rows: MovementHistoryRow[]; nextCursor: string | null }> {
  const limite = i.limit ?? 50;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (i.productId !== undefined) {
    conditions.push(`m.product_id = $${idx}`);
    params.push(i.productId);
    idx += 1;
  }

  if (i.cursor !== undefined) {
    conditions.push(`m.moved_at < $${idx}::timestamptz`);
    params.push(i.cursor);
    idx += 1;
  }

  params.push(limite + 1);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await tx.query<{
    movement_id: string; product_id: string; product_name: string;
    kind: string; quantity: string; reason: string;
    reference_type: string; reference_id: string | null;
    moved_at: string; moved_by: string;
  }>(
    `SELECT m.id AS movement_id, m.product_id,
            p.name AS product_name,
            m.kind::text, m.quantity::text, m.reason,
            m.reference_type::text,
            m.reference_id::text,
            to_char(m.moved_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS moved_at,
            m.moved_by::text
       FROM inv.stock_movement m
       JOIN inv.product p
         ON p.tenant_id = m.tenant_id AND p.id = m.product_id
     ${where}
      ORDER BY m.moved_at DESC
      LIMIT $${idx}`,
    params);

  const hasMore = rows.length > limite;
  const page = hasMore ? rows.slice(0, limite) : rows;
  const mapped = page.map((r) => ({
    movementId: r.movement_id,
    productId: r.product_id,
    productName: r.product_name,
    kind: r.kind,
    quantity: Number(r.quantity),
    reason: r.reason,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    movedAt: r.moved_at,
    movedBy: r.moved_by,
  }));

  const nextCursor = hasMore && mapped.length > 0
    ? mapped[mapped.length - 1]!.movedAt
    : null;

  return { rows: mapped, nextCursor };
}
