// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * Le eventos pendentes da tabela unica app.outbox (NAO existem
 * msg.outbox_event nem fin.outbox_event — ver 00-CONTRATOS.md §3.2),
 * marca como despachado e enfileira o job correspondente no pg-boss.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;

  // Despachar eventos pendentes da tabela unica app.outbox.
  // O papel jobs tem BYPASSRLS e GRANT SELECT, UPDATE (migration 0070).
  // Filtra por dispatched_at IS NULL (pendente) e attempts < 5 (nao dead-letter).
  const { rows: events } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE app.outbox
        SET dispatched_at = clock_timestamp(),
            attempts = attempts + 1
      WHERE dispatched_at IS NULL
        AND attempts < 5
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of events) {
    try {
      // Rotear pelo prefixo do event_type para a fila correta
      const queueName = resolveQueue(ev.event_type);
      await boss.send(queueName, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      // Reverter dispatched_at para retry no proximo ciclo
      await jobsPool().query(
        `UPDATE app.outbox
            SET dispatched_at = NULL,
                last_error = 'falha ao enfileirar no pg-boss'
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  return { dispatched, errors };
}

/** Mapeia event_type para o nome da fila do pg-boss. */
function resolveQueue(eventType: string): string {
  // Eventos de mensageria
  if (eventType === 'INBOUND_MESSAGE_RECEIVED') return 'messaging.inbound_message_received';
  if (eventType.startsWith('APPOINTMENT_')) return `messaging.${eventType.toLowerCase()}`;
  if (eventType === 'ENCOUNTER_FINALIZED') return 'messaging.encounter_finalized';

  // Eventos TISS
  if (eventType === 'ENCOUNTER_AMENDED') return 'tiss.encounter_amended';

  // Eventos financeiros
  if (eventType === 'PAYMENT_RECEIVED') return 'payments.payment_received';
  if (eventType === 'PAYMENT_LINK_CREATED') return 'payments.payment_link_created';

  // Fallback generico
  return `outbox.${eventType.toLowerCase()}`;
}
