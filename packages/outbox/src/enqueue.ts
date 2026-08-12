// packages/outbox/src/enqueue.ts
import type { TxClient } from '@cadencia/db';
import type { EventType } from '@cadencia/events';

export interface EnqueueInput {
  readonly eventType: EventType;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Enfileira um evento de domínio na outbox transacional.
 *
 * DEVE ser chamada DENTRO de withTenantTx — o INSERT participa da mesma
 * transação. Se o COMMIT não acontecer, o evento desaparece junto.
 * Sem job fantasma.
 */
export async function enqueue(
  tx: TxClient,
  input: EnqueueInput,
): Promise<string> {
  const { rows } = await tx.query<{ enqueue_outbox: string }>(
    `SELECT app.enqueue_outbox($1, $2, $3::jsonb)`,
    [input.eventType, input.aggregateId, JSON.stringify(input.payload)],
  );
  return rows[0]!.enqueue_outbox;
}
