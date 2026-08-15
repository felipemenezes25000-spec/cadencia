import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';
import { dispatchOutbox } from './jobs/outbox-dispatcher';
import { sendMessage, type SendMessageInput } from './jobs/send-message';
import { sendReminder, type SendReminderInput } from './jobs/send-reminder';
import { sendEmail, type SendEmailInput } from './jobs/send-email';
import { reconcilePayments } from './jobs/payment-reconciliation';
import { gerarLinkDePagamento, type GerarLinkInput } from './jobs/gerar-link-de-pagamento';
import { refundPaymentAtProvider, type RefundPaymentJobInput } from './jobs/refund-payment';
import { expurgarRetencao } from './jobs/expurgo-retencao';
import { FsStorageAdapter, InMemoryStorageAdapter } from '@cadencia/storage';
import { materializeDailyRollup } from './jobs/daily-rollup';
import { scheduleReminders } from './jobs/reminder-scheduler';
import { selarTrilha, vigiarSelo } from './jobs/audit-seal';
import { reprojetarGuiaTiss } from './jobs/reprojetar-guia-tiss';
import { syncCalendars } from './jobs/calendar-sync';
import { expireTrials } from './jobs/trial-expiration';
import { generateInvoices } from './jobs/invoice-generation';
import { workerProviders } from './providers';
import {
  FILA_RASCUNHOS, FILA_OUTBOX, FILA_ENVIO_MSG, FILA_ENVIO_LEMBRETE,
  FILA_RECONCILIACAO, FILA_LINK_PAGAMENTO, FILA_ESTORNO_PAGAMENTO,
  FILA_ROLLUP, FILA_LEMBRETES, FILA_SELO, FILA_EXPURGO,
  FILA_REPROJECAO_TISS, FILA_EMAIL, FILA_CALENDAR_SYNC,
  FILA_TRIAL_EXPIRACAO, FILA_FATURA_GERACAO,
} from './queues';

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    ...(process.env['DATABASE_JOBS_PASSWORD'] === undefined
      ? {} : { password: process.env['DATABASE_JOBS_PASSWORD'] }),
    schema: 'pgboss',
    migrate: false,
  });
  await boss.start();

  const { messaging, sms, payment, email } = workerProviders();

  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  const armazenamento = process.env['STORAGE_DRIVER'] === 'memory'
    ? new InMemoryStorageAdapter()
    : new FsStorageAdapter(process.env['STORAGE_DIR'] ?? './.armazenamento');

  await boss.work(FILA_EXPURGO, async () => {
    const r = await expurgarRetencao({}, armazenamento);
    process.stdout.write(
      `[worker] expurgo: ${r.valoresExpurgados} valores, ${r.anexosExpurgados} anexos, `
      + `${r.objetosApagados} objetos apagados, ${r.falhas} falhas\n`);
    if (r.falhas > 0) {
      process.stderr.write(
        `[worker] EXPURGO INCOMPLETO: ${r.falhas} objetos permanecem no armazenamento\n`);
    }
  });

  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  await boss.work(FILA_LINK_PAGAMENTO, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as GerarLinkInput;
      const r = await gerarLinkDePagamento(d, payment);
      process.stdout.write(`[worker] link-pagamento: ${d.entryId} -> ${r.status}\n`);
      if (r.status === 'provedor_indisponivel') throw new Error(r.detalhe);
    }
  });

  await boss.work(FILA_ESTORNO_PAGAMENTO, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as RefundPaymentJobInput;
      const r = await refundPaymentAtProvider(d, payment);
      process.stdout.write(`[worker] refund-payment: ${d.paymentId} -> ${r.status}\n`);
      if (r.status === 'indeterminate') {
        process.stderr.write(
          `[worker] ESTORNO INDETERMINADO: ${d.paymentId}: ${r.detail}\n`);
      }
    }
  });

  await boss.work(FILA_ENVIO_MSG, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SendMessageInput & { tenantId: string };
      const r = await sendMessage(data, { whatsapp: messaging, sms });
      process.stdout.write(
        `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
      if (r.status === 'retryable') throw new Error(r.detail);
      if (r.status === 'indeterminate') {
        process.stderr.write(
          `[worker] MENSAGEM INDETERMINADA: ${r.messageId}: ${r.detail}\n`);
      }
    }
  });

  await boss.work(FILA_ENVIO_LEMBRETE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as SendReminderInput;
      const r = await sendReminder(data, { whatsapp: messaging, sms, email });
      process.stdout.write(
        `[worker] reminder: ${data.appointmentId}/${data.ruleId} -> ${r.status}\n`);
      if (r.status === 'retryable') throw new Error(r.detail);
      if (r.status === 'indeterminate') {
        process.stderr.write(
          `[worker] REMINDER INDETERMINADO: ${data.appointmentId}/${data.ruleId}: ${r.detail}\n`);
      }
    }
  });

  await boss.work(FILA_REPROJECAO_TISS, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as { tenantId: string; aggregateId: string };
      const r = await reprojetarGuiaTiss(
        { tenantId: d.tenantId, aggregateId: d.aggregateId });
      process.stdout.write(
        `[worker] reprojecao-tiss: ${d.aggregateId} -> ${r.status}\n`);
      if (r.status === 'falhou') throw new Error(r.detalhe);
    }
  });

  await boss.work(FILA_EMAIL, async (jobs) => {
    for (const job of jobs) {
      const d = job.data as SendEmailInput & { tenantId: string };
      const r = await sendEmail(d, email);
      process.stdout.write(`[worker] email: ${d.to} -> ${r.status}\n`);
      if (r.status === 'provedor_indisponivel') throw new Error('email provider unavailable');
    }
  });

  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  await boss.work(FILA_SELO, async () => {
    const r = await selarTrilha();
    process.stdout.write(
      `[worker] selo ${r.dia}: ${r.tenantsSelados} selados, `
      + `${r.jaSelados} ja selados, ${r.adiados} adiados, ${r.falhas} falhas\n`);

    if (r.falhas > 0) {
      process.stderr.write(
        `[worker] SELO COM FALHA em ${r.falhas} tenant(s): `
        + `${r.detalhes.filter((d) => d.outcome !== 'sucesso')
             .map((d) => `${d.tenantId}=${d.outcome}`).join(', ')}\n`);
    }

    const vigia = await vigiarSelo();
    if (vigia.atrasado) {
      process.stderr.write(
        `[worker] VIGIA DO SELO: ${vigia.status} — ultima execucao `
        + `${vigia.ultimaExecucao ?? 'nunca'}\n`);
    }
  });

  await boss.work(FILA_CALENDAR_SYNC, async () => {
    const r = await syncCalendars();
    process.stdout.write(
      `[worker] calendar-sync: ${r.usersProcessed} usuarios, ${r.eventsSynced} eventos\n`);
  });

  await boss.work(FILA_TRIAL_EXPIRACAO, async () => {
    const r = await expireTrials();
    process.stdout.write(
      `[worker] trial-expiration: ${r.expired} expirados, ${r.skipped} pulados\n`);
  });

  await boss.work(FILA_FATURA_GERACAO, async () => {
    const r = await generateInvoices();
    process.stdout.write(
      `[worker] invoice-generation: ${r.generated} geradas, ${r.skipped} puladas\n`);
  });

  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');
  await boss.schedule(FILA_OUTBOX, '*/5 * * * * *');
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');
  await boss.schedule(FILA_LEMBRETES, '* * * * *');
  await boss.schedule(FILA_SELO, '30 2 * * *');
  await boss.schedule(FILA_EXPURGO, '10 4 * * *');
  await boss.schedule(FILA_CALENDAR_SYNC, '*/15 * * * *');
  await boss.schedule(FILA_TRIAL_EXPIRACAO, '0 6 * * *');
  await boss.schedule(FILA_FATURA_GERACAO, '0 5 1 * *');

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
