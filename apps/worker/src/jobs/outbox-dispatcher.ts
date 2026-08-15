// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';
import {
  FILA_ENVIO_MSG,
  FILA_LINK_PAGAMENTO,
  FILA_REPROJECAO_TISS,
} from '../queues';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * A garantia aqui é AT-LEAST-ONCE. O evento só recebe `dispatched_at` depois
 * que o pg-boss aceitou o job. Se o processo cair entre o enqueue e o COMMIT,
 * a transação volta e o evento será tentado de novo — pode duplicar, mas nunca
 * desaparece. Consumidores usam as chaves estáveis do agregado/evento para
 * tornar a reentrega idempotente.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

const LOTE_POR_CICLO = 100;

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;
  const client = await jobsPool().connect();
  let conexaoQuebrada = false;

  try {
    await client.query('BEGIN');

    const { rows: events } = await client.query<{
      id: string; event_type: string; aggregate_id: string;
      payload: Record<string, unknown>; tenant_id: string;
    }>(
      `SELECT p.id, p.event_type, p.aggregate_id, p.payload, p.tenant_id
         FROM app.outbox p
        WHERE p.dispatched_at IS NULL
          AND p.attempts < 5
          AND p.created_at < clock_timestamp() - interval '100 milliseconds'
        ORDER BY p.created_at, p.id
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [LOTE_POR_CICLO],
    );

    for (const ev of events) {
      try {
        const queueName = resolveQueue(ev.event_type);
        await boss.send(queueName, {
          outboxEventId: ev.id,
          tenantId: ev.tenant_id,
          aggregateId: ev.aggregate_id,
          ...ev.payload,
        });

        await client.query(
          `UPDATE app.outbox
              SET dispatched_at = clock_timestamp(),
                  attempts = attempts + 1,
                  last_error = NULL
            WHERE id = $1`,
          [ev.id],
        );
        dispatched += 1;
      } catch {
        await client.query(
          `UPDATE app.outbox
              SET attempts = attempts + 1,
                  last_error = 'falha ao enfileirar no pg-boss'
            WHERE id = $1`,
          [ev.id],
        );
        errors += 1;
      }
    }

    await client.query('COMMIT');
    return { dispatched, errors };
  } catch (erro) {
    try {
      await client.query('ROLLBACK');
    } catch {
      conexaoQuebrada = true;
    }
    throw erro;
  } finally {
    client.release(
      conexaoQuebrada ? new Error('conexao descartada: rollback do outbox falhou') : undefined,
    );
  }
}

/** Mapeia event_type para o nome da fila do pg-boss. */
function resolveQueue(eventType: string): string {
  // Eventos gerados diretamente pelas rotas HTTP usam snake_case.
  // Eles precisam cair nas MESMAS filas que o worker consome; o fallback
  // `outbox.${eventType}` fazia `send_message` virar `outbox.send_message`,
  // uma fila inexistente, e a mensagem ficava perdida no limbo.
  if (eventType === 'send_message') return FILA_ENVIO_MSG;
  if (eventType === 'create_payment_link') return FILA_LINK_PAGAMENTO;

  if (eventType === 'INBOUND_MESSAGE_RECEIVED') return 'messaging.inbound_message_received';
  if (eventType.startsWith('APPOINTMENT_')) return `messaging.${eventType.toLowerCase()}`;
  if (eventType === 'ENCOUNTER_FINALIZED') return 'messaging.encounter_finalized';

  if (eventType === 'ENCOUNTER_AMENDED') return FILA_REPROJECAO_TISS;

  if (eventType === 'PAYMENT_RECEIVED') return 'payments.payment_received';
  if (eventType === 'PAYMENT_LINK_CREATED') return 'payments.payment_link_created';

  return `outbox.${eventType.toLowerCase()}`;
}
