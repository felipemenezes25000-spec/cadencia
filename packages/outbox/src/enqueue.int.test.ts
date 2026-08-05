// packages/outbox/src/enqueue.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { enqueue } from './enqueue';
import { semearOutbox, type SementeOutbox } from './test-support';

let s: SementeOutbox;
let actor: Actor;

beforeAll(async () => {
  s = await semearOutbox();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('enqueue outbox', () => {
  it('insere evento na outbox dentro da transacao de dominio', async () => {
    const aggregateId = uuidv7();
    const outboxId = await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'APPOINTMENT_CONFIRMED',
        aggregateId,
        payload: { appointmentId: aggregateId, confirmedBy: 'patient' },
      }),
    );
    expect(outboxId).toBeTruthy();

    // verifica que esta no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string; event_type: string; dispatched_at: string | null }>(
        `SELECT id, event_type, dispatched_at FROM app.outbox WHERE id = $1`,
        [outboxId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('APPOINTMENT_CONFIRMED');
    expect(rows[0]!.dispatched_at).toBeNull();
  });

  it('evento desaparece quando a transacao faz rollback', async () => {
    const aggregateId = uuidv7();
    let outboxId = '';
    try {
      await withTenantTx(actor, async (tx) => {
        outboxId = await enqueue(tx, {
          eventType: 'ENCOUNTER_FINALIZED',
          aggregateId,
          payload: { encounterId: aggregateId },
        });
        throw new Error('rollback proposital');
      });
    } catch {
      // esperado
    }
    expect(outboxId).toBeTruthy();

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM app.outbox WHERE id = $1`,
        [outboxId],
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('isolamento: tenant B nao ve evento do tenant A', async () => {
    const aggregateId = uuidv7();
    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'PAYMENT_RECEIVED',
        aggregateId,
        payload: { paymentId: aggregateId, amountCents: 10000 },
      }),
    );

    // criar segundo tenant
    const s2 = await semearOutbox();
    const actorB: Actor = {
      kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
      clinicId: s2.clinicId, requestId: uuidv7(),
    };
    const { rows } = await withTenantTx(actorB, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM app.outbox`),
    );
    // tenant B nao ve eventos de tenant A
    const idsA = rows.filter((r) => r.id === aggregateId);
    expect(idsA).toHaveLength(0);
  });
});
