// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * Lê eventos pendentes da tabela única app.outbox (NÃO existem
 * msg.outbox_event nem fin.outbox_event — ver 00-CONTRATOS.md §3.2),
 * marca como despachado e enfileira o job correspondente no pg-boss.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

/**
 * Quantos eventos um ciclo reivindica.
 *
 * Constante e não parâmetro: o valor certo depende da cadência do polling (5 s)
 * e do custo de um envio ao pg-boss, não de quem chama. Cem por ciclo são 1200
 * por minuto — muito acima do que a clínica produz — e mantém pequena a janela
 * entre "marcado como despachado" e "de fato na fila".
 */
const LOTE_POR_CICLO = 100;

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;

  // Despachar eventos pendentes da tabela única app.outbox.
  // O papel jobs tem BYPASSRLS e GRANT SELECT, UPDATE (migration 0070).
  // Filtra por dispatched_at IS NULL (pendente) e attempts < 5 (não dead-letter).
  //
  // Três coisas que o UPDATE direto não tinha:
  //
  // 1. LIMITE. Sem ele, um acúmulo de eventos — worker parado meia hora, carga
  //    de importação — era reivindicado INTEIRO num único statement, que commita
  //    sozinho. Se o processo morresse na metade do laço de envio, todos os
  //    eventos restantes ficavam com `dispatched_at` preenchido e nunca chegavam
  //    à fila: perda silenciosa proporcional ao tamanho do acúmulo. Com lote de
  //    100, o prejuízo de uma queda é no máximo 100 eventos, e o ciclo de 5 s
  //    esvazia a fila do mesmo jeito.
  //
  // 2. ORDEM. Sem `ORDER BY`, a entrega saía na ordem física das linhas. Evento
  //    de domínio tem ordem: APPOINTMENT_CANCELLED chegando antes do
  //    APPOINTMENT_CREATED correspondente manda a mensagem errada ao paciente.
  //
  // 3. SKIP LOCKED. Dois workers rodando ao mesmo tempo — durante um deploy, por
  //    exemplo — não brigam mais pela mesma linha: o segundo pula o que o
  //    primeiro reservou em vez de ficar bloqueado até o commit dele.
  const { rows: events } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE app.outbox o
        SET dispatched_at = clock_timestamp(),
            attempts = attempts + 1
      WHERE o.id IN (
              SELECT p.id
                FROM app.outbox p
               WHERE p.dispatched_at IS NULL
                 AND p.attempts < 5
                 AND p.created_at < clock_timestamp() - interval '100 milliseconds'
               ORDER BY p.created_at, p.id
                 FOR UPDATE SKIP LOCKED
               LIMIT ${LOTE_POR_CICLO})
      RETURNING o.id, o.event_type, o.aggregate_id, o.payload, o.tenant_id`);

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
      // Reverter dispatched_at para retry no próximo ciclo
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

  // Fallback genérico
  return `outbox.${eventType.toLowerCase()}`;
}
