// packages/outbox/src/outbox-worker.ts
import type { Pool } from 'pg';
import type { OutboxRow } from './dispatcher';

/**
 * Busca eventos pendentes de despacho.
 *
 * Roda com o papel `jobs` (BYPASSRLS): precisa ler eventos de TODOS os tenants.
 * O filtro e: dispatched_at IS NULL AND attempts < 5, ordenado por created_at.
 * FOR UPDATE SKIP LOCKED evita que dois workers processem o mesmo evento.
 */
export async function fetchPending(pool: Pool, limit: number): Promise<OutboxRow[]> {
  const { rows } = await pool.query<{
    id: string;
    tenant_id: string;
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    created_at: string;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT id, tenant_id, event_type, aggregate_id, payload,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
            attempts, last_error
       FROM app.outbox
      WHERE dispatched_at IS NULL AND attempts < 5
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type,
    aggregateId: r.aggregate_id,
    payload: r.payload,
    createdAt: r.created_at,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

/**
 * Marca um evento como despachado com sucesso.
 * Roda com o papel `jobs` (BYPASSRLS).
 */
export async function markDispatched(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `UPDATE app.outbox SET dispatched_at = clock_timestamp() WHERE id = $1`,
    [id],
  );
}

/**
 * Marca falha: incrementa attempts e grava last_error.
 * Roda com o papel `jobs` (BYPASSRLS).
 */
export async function markFailed(pool: Pool, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE app.outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
    [id, error],
  );
}
