// packages/outbox/src/outbox-worker.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { enqueue } from './enqueue';
import { fetchPending, markDispatched, markFailed } from './outbox-worker';
import { createDispatcher, type OutboxHandler } from './dispatcher';
import { semearOutbox, type SementeOutbox } from './test-support';

let s: SementeOutbox;
let actor: Actor;

beforeAll(async () => {
  s = await semearOutbox();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
  // Limpa eventos pendentes de execucoes anteriores para nao poluir o teste
  const pool = jobsPool();
  await pool.query(
    `UPDATE app.outbox SET dispatched_at = clock_timestamp() WHERE dispatched_at IS NULL`,
  );
});
afterAll(async () => { await closePools(); });

describe('outbox worker - ciclo completo', () => {
  it('enqueue + fetchPending + dispatch + markDispatched', async () => {
    const aggregateId = uuidv7();

    // 1. Enfileira dentro da transacao
    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'APPOINTMENT_CONFIRMED',
        aggregateId,
        payload: { appointmentId: aggregateId, confirmedBy: 'clinic' },
      }),
    );

    // 2. Busca pendentes (roda com jobs, BYPASSRLS)
    const pool = jobsPool();
    const pending = await fetchPending(pool, 10);
    const meuEvento = pending.find((r) => r.aggregateId === aggregateId);
    expect(meuEvento).toBeDefined();
    expect(meuEvento!.eventType).toBe('APPOINTMENT_CONFIRMED');
    expect(meuEvento!.attempts).toBe(0);

    // 3. Despacha com handler
    const chamadas: string[] = [];
    const handler: OutboxHandler = async (row) => {
      chamadas.push(row.id);
    };
    const dispatcher = createDispatcher({
      handlers: { APPOINTMENT_CONFIRMED: handler },
      markDispatched: (id) => markDispatched(pool, id),
      markFailed: (id, error) => markFailed(pool, id, error),
    });

    const result = await dispatcher.dispatch(meuEvento!);
    expect(result).toEqual({ status: 'dispatched' });
    expect(chamadas).toContain(meuEvento!.id);

    // 4. Verifica que nao aparece mais como pendente
    const pending2 = await fetchPending(pool, 10);
    const depois = pending2.find((r) => r.id === meuEvento!.id);
    expect(depois).toBeUndefined();
  });

  it('markFailed incrementa attempts e grava last_error', async () => {
    const aggregateId = uuidv7();

    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'ENCOUNTER_FINALIZED',
        aggregateId,
        payload: { encounterId: aggregateId },
      }),
    );

    const pool = jobsPool();
    const pending = await fetchPending(pool, 10);
    const meuEvento = pending.find((r) => r.aggregateId === aggregateId);
    expect(meuEvento).toBeDefined();

    await markFailed(pool, meuEvento!.id, 'erro de teste');

    // busca de novo — deve ter attempts = 1
    const pending2 = await fetchPending(pool, 10);
    const depois = pending2.find((r) => r.id === meuEvento!.id);
    expect(depois).toBeDefined();
    expect(depois!.attempts).toBe(1);
    expect(depois!.lastError).toBe('erro de teste');
  });

  it('evento com 5 tentativas nao aparece em fetchPending', async () => {
    const aggregateId = uuidv7();

    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'PAYMENT_RECEIVED',
        aggregateId,
        payload: { paymentId: aggregateId },
      }),
    );

    const pool = jobsPool();

    // simula 5 falhas
    for (let i = 0; i < 5; i++) {
      const pending = await fetchPending(pool, 10);
      const evt = pending.find((r) => r.aggregateId === aggregateId);
      expect(evt).toBeDefined();
      await markFailed(pool, evt!.id, `falha ${i + 1}`);
    }

    // na sexta busca, nao deve aparecer
    const pending = await fetchPending(pool, 10);
    const evt = pending.find((r) => r.aggregateId === aggregateId);
    expect(evt).toBeUndefined();

    // mas deve estar no banco como dead-letter (attempts >= 5, dispatched_at IS NULL)
    const { rows } = await pool.query<{ attempts: number; dispatched_at: string | null }>(
      `SELECT attempts, dispatched_at FROM app.outbox WHERE aggregate_id = $1`,
      [aggregateId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(5);
    expect(rows[0]!.dispatched_at).toBeNull();
  });
});
