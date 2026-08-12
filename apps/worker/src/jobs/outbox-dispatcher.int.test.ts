// apps/worker/src/jobs/outbox-dispatcher.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { dispatchOutbox } from './outbox-dispatcher';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let boss: PgBoss;
let tenantId: string;
let outboxEventId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();
  outboxEventId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Outbox Test', '77777777000197')`,
      [tenantId, `ob-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ob', '2077508', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);

    // Inserir evento de outbox pendente na tabela única app.outbox
    await c.query(
      `INSERT INTO app.outbox
         (tenant_id, id, event_type, aggregate_id, payload,
          created_at)
       VALUES ($1, $2, 'PAYMENT_RECEIVED', $3,
               '{"messageId":"m1","conversationId":"c1"}'::jsonb,
               clock_timestamp() - interval '1 second')`,
      [tenantId, outboxEventId, uuidv7()]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();

  boss = new PgBoss({
    connectionString: adminUrl(),
    schema: 'pgboss',
  });
  await boss.start();
});

afterAll(async () => {
  await boss.stop();
  await closePools();
});

describe('despachante de outbox', () => {
  it('despacha eventos pendentes e marca dispatched_at', async () => {
    const r = await dispatchOutbox(boss);
    expect(r.dispatched).toBeGreaterThanOrEqual(1);
    expect(r.errors).toBe(0);

    // Verificar que o evento foi marcado com dispatched_at
    const { rows } = await jobsPool().query<{ dispatched_at: string | null }>(
      `SELECT dispatched_at::text FROM app.outbox WHERE id = $1`, [outboxEventId]);
    expect(rows[0]?.dispatched_at).not.toBeNull();
  });
});
