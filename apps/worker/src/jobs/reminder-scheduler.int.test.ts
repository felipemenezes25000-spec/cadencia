// apps/worker/src/jobs/reminder-scheduler.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import PgBoss from 'pg-boss';
import { scheduleReminders } from './reminder-scheduler';

let boss: PgBoss;

afterAll(async () => {
  if (boss) await boss.stop();
  await closePools();
});

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

describe('agendador de lembretes', () => {
  it('roda sem erro mesmo sem regras habilitadas', async () => {
    boss = new PgBoss({
      connectionString: adminUrl(),
      schema: 'pgboss',
    });
    await boss.start();

    const r = await scheduleReminders(boss);
    expect(r.scheduled).toBeGreaterThanOrEqual(0);
    expect(r.skipped).toBeGreaterThanOrEqual(0);
  });
});
