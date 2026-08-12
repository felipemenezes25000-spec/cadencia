import type { Pool } from 'pg';

export interface AlertJobResult {
  readonly created: number;
  readonly resolved: number;
}

/**
 * Job diário de alerta de estoque. Roda com o papel `jobs` (BYPASSRLS),
 * NÃO usa withTenantTx. Varre todos os tenants:
 * 1. Cria alerta para produtos com current_stock < min_stock que não têm alerta aberto.
 * 2. Resolve alertas cujo produto voltou ao nível (current_stock >= min_stock).
 * 3. Enfileira evento STOCK_LOW no outbox para cada alerta criado.
 */
export async function runStockAlertJob(jobsPool: Pool): Promise<AlertJobResult> {
  const c = await jobsPool.connect();
  let created = 0;
  let resolved = 0;

  try {
    await c.query('BEGIN');

    // 1. Criar alertas para produtos abaixo do mínimo sem alerta aberto
    const { rows: newAlerts } = await c.query<{
      tenant_id: string; product_id: string;
      product_name: string; current_stock: string; min_stock: string;
    }>(
      `INSERT INTO inv.stock_alert (tenant_id, id, product_id, threshold)
       SELECT p.tenant_id, gen_random_uuid(), p.id, p.min_stock
         FROM inv.product p
        WHERE p.active
          AND p.min_stock > 0
          AND p.current_stock < p.min_stock
          AND NOT EXISTS (
            SELECT 1 FROM inv.stock_alert a
             WHERE a.tenant_id = p.tenant_id
               AND a.product_id = p.id
               AND a.resolved_at IS NULL
          )
       RETURNING tenant_id, product_id,
                 (SELECT name FROM inv.product WHERE id = product_id AND tenant_id = inv.stock_alert.tenant_id) AS product_name,
                 (SELECT current_stock::text FROM inv.product WHERE id = product_id AND tenant_id = inv.stock_alert.tenant_id) AS current_stock,
                 threshold::text AS min_stock`);

    created = newAlerts.length;

    // 2. Enfileirar eventos STOCK_ALERT_TRIGGERED no outbox para cada novo alerta
    for (const alert of newAlerts) {
      await c.query(
        `INSERT INTO app.outbox (tenant_id, event_type, aggregate_id, payload)
         VALUES ($1, 'STOCK_ALERT_TRIGGERED', $2,
                 jsonb_build_object(
                   'productId', $3::text,
                   'productName', $4::text,
                   'currentStock', $5::numeric,
                   'threshold', $6::numeric
                 ))`,
        [alert.tenant_id, alert.product_id,
         alert.product_id, alert.product_name,
         Number(alert.current_stock), Number(alert.min_stock)]);
    }

    // 3. Resolver alertas cujo produto voltou ao nível
    const { rowCount: resolvedCount } = await c.query(
      `UPDATE inv.stock_alert a
          SET resolved_at = clock_timestamp()
         FROM inv.product p
        WHERE a.tenant_id = p.tenant_id
          AND a.product_id = p.id
          AND a.resolved_at IS NULL
          AND p.current_stock >= p.min_stock`);

    resolved = resolvedCount ?? 0;

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  return { created, resolved };
}
