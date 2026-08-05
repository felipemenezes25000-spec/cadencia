import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';
import { dispatchOutbox } from './jobs/outbox-dispatcher';
import { sendMessage, type SendMessageInput } from './jobs/send-message';
import { reconcilePayments } from './jobs/payment-reconciliation';
import { materializeDailyRollup } from './jobs/daily-rollup';
import { scheduleReminders } from './jobs/reminder-scheduler';
import {
  createFakeMessagingProvider, createFakePaymentProvider,
} from '@cadencia/integrations';

const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
const FILA_OUTBOX = 'outbox.dispatch';
const FILA_ENVIO_MSG = 'messaging.send_message';
const FILA_RECONCILIACAO = 'payments.reconciliation';
const FILA_ROLLUP = 'fin.daily-rollup';
const FILA_LEMBRETES = 'messaging.schedule-reminders';

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  const messaging = usarFakes ? createFakeMessagingProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();
  const payment = usarFakes ? createFakePaymentProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();

  // -- Job existente: auto-finalizacao ------------------------------------------
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // -- Despachante de outbox (polling a cada 5s) --------------------------------
  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  // -- Envio de mensagens (consome outbox de tipo messaging) --------------------
  await boss.work(FILA_ENVIO_MSG, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SendMessageInput & { tenantId: string };
      const r = await sendMessage(data, messaging);
      process.stdout.write(
        `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
    }
  });

  // -- Reconciliacao noturna ----------------------------------------------------
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // -- Materializacao do daily_rollup -------------------------------------------
  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  // -- Agendamento de lembretes -------------------------------------------------
  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  // -- Schedules ----------------------------------------------------------------
  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');
  await boss.schedule(FILA_OUTBOX, '*/5 * * * * *');       // cada 5 segundos
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');    // 4h da manha
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');          // 3h30 da manha
  await boss.schedule(FILA_LEMBRETES, '* * * * *');        // a cada minuto

  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => { await boss.stop(); await closePools(); process.exit(0); })();
    });
  }
}

if (process.env.NODE_ENV !== 'test') void main();
