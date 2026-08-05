### Task 41: worker jobs — despachante de outbox, envio de mensagens, reconciliacao, rollup e lembretes

**Arquivos**
- Criar `apps/worker/src/jobs/outbox-dispatcher.ts`
- Criar `apps/worker/src/jobs/outbox-dispatcher.int.test.ts`
- Criar `apps/worker/src/jobs/send-message.ts`
- Criar `apps/worker/src/jobs/send-message.int.test.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.int.test.ts`
- Criar `apps/worker/src/jobs/daily-rollup.ts`
- Criar `apps/worker/src/jobs/daily-rollup.int.test.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.int.test.ts`
- Modificar `apps/worker/src/worker.ts`

**Passos**

- [ ] Criar o despachante de outbox `apps/worker/src/jobs/outbox-dispatcher.ts`.

```ts
// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * Le eventos pendentes das tabelas de outbox (msg.outbox_event e fin.outbox_event),
 * marca como 'dispatched' e enfileira o job correspondente no pg-boss.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;

  // Despachar eventos de mensageria
  const { rows: msgEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE msg.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of msgEvents) {
    try {
      await boss.send(`messaging.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      // Reverter status para retry no proximo ciclo
      await jobsPool().query(
        `UPDATE msg.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  // Despachar eventos financeiros
  const { rows: finEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE fin.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of finEvents) {
    try {
      await boss.send(`payments.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      await jobsPool().query(
        `UPDATE fin.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  return { dispatched, errors };
}
```

- [ ] Criar o job de envio de mensagens `apps/worker/src/jobs/send-message.ts`.

```ts
// apps/worker/src/jobs/send-message.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { MessagingProvider } from '@cadencia/integrations';

export interface SendMessageInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export interface SendMessageResult {
  readonly messageId: string;
  readonly status: 'sent' | 'failed' | 'indeterminate';
  readonly providerMessageId: string | null;
}

export async function sendMessage(
  input: SendMessageInput,
  messaging: MessagingProvider,
): Promise<SendMessageResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'send-message',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    // Ler a mensagem e a conversa
    const { rows: msgRows } = await tx.query<{
      body: string; conversation_id: string;
    }>(
      `SELECT body, conversation_id FROM msg.message WHERE id = $1`,
      [input.messageId]);

    if (msgRows.length === 0) {
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const msg = msgRows[0]!;

    // Ler a conversa para obter o destinatario e a channel_identity
    const { rows: convRows } = await tx.query<{
      remote_address: string; channel_identity_id: string;
    }>(
      `SELECT remote_address, channel_identity_id
         FROM msg.conversation WHERE id = $1`,
      [msg.conversation_id]);

    if (convRows.length === 0) {
      await tx.query(
        `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const conv = convRows[0]!;

    // Ler o ref da channel_identity
    const { rows: ciRows } = await tx.query<{ provider_ref: string }>(
      `SELECT coalesce(provider_ref, id::text) AS provider_ref
         FROM msg.channel_identity WHERE id = $1`,
      [conv.channel_identity_id]);

    const channelIdentityRef = ciRows[0]?.provider_ref ?? '';

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `msg-${input.messageId}`,
      deadlineMs: 10_000,
    };

    const resultado = await messaging.send(ctx, {
      channelIdentityRef,
      to: conv.remote_address as never,
      body: { kind: 'text', text: msg.body },
      conversationId: msg.conversation_id,
    });

    if (resultado.ok) {
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', provider_message_id = $2, sent_at = clock_timestamp()
          WHERE id = $1`,
        [input.messageId, resultado.value.providerMessageId]);
      return { messageId: input.messageId, status: 'sent' as const,
               providerMessageId: resultado.value.providerMessageId };
    }

    // Timeout em operacao unsafe: estado indeterminado, agendar reconciliacao
    if (resultado.error.kind === 'timeout') {
      await tx.query(
        `UPDATE msg.message SET status = 'indeterminate' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'indeterminate' as const,
               providerMessageId: null };
    }

    await tx.query(
      `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
      [input.messageId]);
    return { messageId: input.messageId, status: 'failed' as const,
             providerMessageId: null };
  });
}
```

- [ ] Criar o job de reconciliacao de pagamentos `apps/worker/src/jobs/payment-reconciliation.ts`.

```ts
// apps/worker/src/jobs/payment-reconciliation.ts
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, isoFromMs, systemClock } from '@cadencia/kernel';
import type { PaymentProvider } from '@cadencia/integrations';
import { asRfc3339 } from '@cadencia/integrations';

export interface ReconciliationResult {
  readonly tenantsProcessed: number;
  readonly settlementsFound: number;
  readonly divergences: number;
}

/**
 * Reconciliacao noturna — busca settlements do PSP e compara com o nosso banco.
 *
 * Roda como job noturno. Para cada tenant com PSP configurado, busca os
 * settlements do dia anterior e marca divergencias.
 */
export async function reconcilePayments(
  payment: PaymentProvider,
): Promise<ReconciliationResult> {
  // Buscar tenants com pagamentos PSP nos ultimos 30 dias
  const { rows: tenants } = await jobsPool().query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM fin.payment
      WHERE provider_payment_id IS NOT NULL
        AND paid_at > clock_timestamp() - interval '30 days'`);

  let settlementsFound = 0;
  let divergences = 0;

  const ontem = new Date(systemClock.nowMs() - 86_400_000);
  const from = asRfc3339(isoFromMs(ontem.setUTCHours(0, 0, 0, 0)));
  const to = asRfc3339(isoFromMs(ontem.setUTCHours(23, 59, 59, 999)));

  if (from === null || to === null) {
    return { tenantsProcessed: 0, settlementsFound: 0, divergences: 0 };
  }

  for (const t of tenants) {
    const actor: Actor = {
      kind: 'system',
      tenantId: t.tenant_id,
      reason: 'payment-reconciliation',
      requestId: uuidv7(),
    };

    const ctx = {
      tenantId: t.tenant_id,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `recon-${t.tenant_id}-${isoFromMs(systemClock.nowMs()).slice(0, 10)}`,
      deadlineMs: 30_000,
    };

    const resultado = await payment.fetchSettlements(ctx, { from, to });
    if (!resultado.ok) continue;

    for (const settlement of resultado.value) {
      settlementsFound += 1;

      await withTenantTx(actor, async (tx) => {
        // Verificar se o pagamento existe com o valor correto
        const { rows } = await tx.query<{
          id: string; amount_cents: string; status: string;
        }>(
          `SELECT id, amount_cents::text, status::text
             FROM fin.payment WHERE provider_payment_id = $1`,
          [settlement.providerPaymentId]);

        if (rows.length === 0) {
          // Pagamento no PSP que nao esta no nosso banco — divergencia
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'missing_local', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Pagamento ${settlement.providerPaymentId} encontrado no PSP mas ausente no banco`]);
          return;
        }

        const pay = rows[0]!;
        const localCents = Number(pay.amount_cents);
        if (localCents !== settlement.netAmountCents) {
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'amount_mismatch', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Local: ${localCents}, PSP net: ${settlement.netAmountCents}, taxa: ${settlement.feeCents}`]);
        }

        // Gravar a taxa real do PSP
        await tx.query(
          `UPDATE fin.payment
              SET provider_fee_cents = $2, provider_net_cents = $3,
                  reconciled_at = clock_timestamp()
            WHERE id = $1`,
          [pay.id, settlement.feeCents, settlement.netAmountCents]);
      });
    }
  }

  return { tenantsProcessed: tenants.length, settlementsFound, divergences };
}
```

- [ ] Criar o job de materializacao do daily_rollup `apps/worker/src/jobs/daily-rollup.ts`.

```ts
// apps/worker/src/jobs/daily-rollup.ts
import { jobsPool } from '@cadencia/db';

export interface DailyRollupResult {
  readonly rowsUpserted: number;
  readonly tenantsProcessed: number;
}

/**
 * Materializa fin.daily_rollup a partir de fin.payment.
 *
 * Roda diariamente apos o fechamento do dia. Agrega pagamentos por
 * tenant_id, clinic_id, dia, base (competencia/caixa), metodo e status.
 */
export async function materializeDailyRollup(
  opts: { dia?: string } = {},
): Promise<DailyRollupResult> {
  // Se nao especificado, processar o dia anterior
  const diaQuery = opts.dia !== undefined
    ? `$1::date`
    : `(clock_timestamp() - interval '1 day')::date`;
  const params = opts.dia !== undefined ? [opts.dia] : [];

  // Upsert no rollup — base 'caixa' agrega por paid_at
  const resultCaixa = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'caixa' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  // Upsert no rollup — base 'competencia' agrega por created_at
  const resultCompetencia = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'competencia' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  const rowsUpserted = (resultCaixa.rowCount ?? 0) + (resultCompetencia.rowCount ?? 0);

  // Contar tenants distintos processados
  const { rows } = await jobsPool().query<{ n: string }>(
    `SELECT count(DISTINCT tenant_id)::text AS n FROM fin.daily_rollup
      WHERE day = ${diaQuery}`,
    params,
  );

  return {
    rowsUpserted,
    tenantsProcessed: Number(rows[0]?.n ?? 0),
  };
}
```

- [ ] Criar o job de agendamento de lembretes `apps/worker/src/jobs/reminder-scheduler.ts`.

```ts
// apps/worker/src/jobs/reminder-scheduler.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

export interface ReminderScheduleResult {
  readonly scheduled: number;
  readonly skipped: number;
}

/**
 * Agenda lembretes e confirmacoes automaticas.
 *
 * Varre msg.automation_rule para regras habilitadas, encontra agendamentos
 * que se encaixam no criterio de offset e agenda jobs de envio.
 *
 * Meta: entrega de lembrete dentro da janela 99,5% (Apendice A).
 */
export async function scheduleReminders(boss: PgBoss): Promise<ReminderScheduleResult> {
  let scheduled = 0;
  let skipped = 0;

  // Buscar regras ativas
  const { rows: rules } = await jobsPool().query<{
    id: string; tenant_id: string; trigger: string; template_id: string | null;
    offset_minutes: string; channel_kind: string;
  }>(
    `SELECT r.id, r.tenant_id, r.trigger, r.template_id,
            r.offset_minutes::text, r.channel_kind
       FROM msg.automation_rule r
      WHERE r.enabled = true`);

  for (const rule of rules) {
    const offsetMinutes = Number(rule.offset_minutes);

    // Buscar agendamentos que precisam de lembrete/confirmacao
    // O offset negativo significa "antes do agendamento"
    // Ex: offset_minutes = -1440 significa 24h antes
    const { rows: appointments } = await jobsPool().query<{
      appointment_id: string; patient_id: string; starts_at: string;
      patient_phone: string | null; patient_name: string;
    }>(
      `SELECT a.id AS appointment_id, a.patient_id,
              to_char(a.starts_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at,
              pat.phone_primary AS patient_phone,
              pat.full_name AS patient_name
         FROM sched.appointment a
         JOIN clin.patient pat ON pat.tenant_id = a.tenant_id AND pat.id = a.patient_id
        WHERE a.tenant_id = $1
          AND a.status IN ('agendado', 'confirmado')
          AND a.starts_at + make_interval(mins => $2)
              BETWEEN clock_timestamp() AND clock_timestamp() + interval '6 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM msg.sent_reminder sr
             WHERE sr.appointment_id = a.id AND sr.rule_id = $3
          )`,
      [rule.tenant_id, offsetMinutes, rule.id]);

    for (const appt of appointments) {
      if (appt.patient_phone === null || appt.patient_phone === '') {
        skipped += 1;
        continue;
      }

      try {
        await boss.send('messaging.send_reminder', {
          tenantId: rule.tenant_id,
          appointmentId: appt.appointment_id,
          patientId: appt.patient_id,
          patientPhone: appt.patient_phone,
          patientName: appt.patient_name,
          startsAt: appt.starts_at,
          templateId: rule.template_id,
          channelKind: rule.channel_kind,
          ruleId: rule.id,
        });

        // Marcar como agendado para nao duplicar
        await jobsPool().query(
          `INSERT INTO msg.sent_reminder
             (id, tenant_id, appointment_id, rule_id, scheduled_at)
           VALUES (gen_random_uuid(), $1, $2, $3, clock_timestamp())`,
          [rule.tenant_id, appt.appointment_id, rule.id]);

        scheduled += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  return { scheduled, skipped };
}
```

- [ ] Atualizar o worker para registrar todos os novos jobs `apps/worker/src/worker.ts`.

```ts
// apps/worker/src/worker.ts
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

  // ── Job existente: auto-finalizacao ──────────────────────────────────────
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // ── Despachante de outbox (polling a cada 5s) ────────────────────────────
  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  // ── Envio de mensagens (consome outbox de tipo messaging) ────────────────
  await boss.work(FILA_ENVIO_MSG, async (job) => {
    const data = job.data as SendMessageInput & { tenantId: string };
    const r = await sendMessage(data, messaging);
    process.stdout.write(
      `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
  });

  // ── Reconciliacao noturna ────────────────────────────────────────────────
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // ── Materializacao do daily_rollup ───────────────────────────────────────
  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  // ── Agendamento de lembretes ─────────────────────────────────────────────
  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  // ── Schedules ────────────────────────────────────────────────────────────
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
```

- [ ] Criar testes de integracao para os jobs do worker.

```ts
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

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();

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

    // Inserir evento de outbox pendente
    await c.query(
      `INSERT INTO msg.outbox_event
         (tenant_id, id, event_type, aggregate_id, payload, status,
          created_at)
       VALUES ($1, $2, 'send_message', $3,
               '{"messageId":"m1","conversationId":"c1"}'::jsonb,
               'pending', clock_timestamp() - interval '1 second')`,
      [tenantId, uuidv7(), uuidv7()]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();
});

afterAll(async () => {
  await boss.stop();
  await closePools();
});

describe('despachante de outbox', () => {
  it('despacha eventos pendentes e marca como dispatched', async () => {
    const r = await dispatchOutbox(boss);
    expect(r.dispatched).toBeGreaterThanOrEqual(1);
    expect(r.errors).toBe(0);

    // Verificar que o evento foi marcado
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status FROM msg.outbox_event WHERE tenant_id = $1`, [tenantId]);
    expect(rows.every((row) => row.status === 'dispatched')).toBe(true);
  });
});
```

```ts
// apps/worker/src/jobs/send-message.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeMessagingProvider } from '@cadencia/integrations';
import { Pool } from 'pg';
import { sendMessage } from './send-message';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let messageId: string;
let conversationId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();
  const channelIdentityId = uuidv7();
  conversationId = uuidv7();
  messageId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Send Test', '88888888000198')`,
      [tenantId, `snd-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Snd', '2077509', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Snd', '+5511999777666', 'verified')`,
      [tenantId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, channel_kind,
          remote_address, status, last_message_at, unread_count)
       VALUES ($1, $2, $3, 'whatsapp', '+5511988776655', 'open',
               clock_timestamp(), 0)`,
      [tenantId, conversationId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, body, status)
       VALUES ($1, $2, $3, 'outbound', 'Sua consulta esta confirmada', 'queued')`,
      [tenantId, messageId, conversationId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('envio de mensagem via worker', () => {
  it('envia a mensagem e atualiza o status para sent', async () => {
    const messaging = createFakeMessagingProvider();
    const r = await sendMessage({
      tenantId, messageId, conversationId,
    }, messaging);

    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM msg.message WHERE id = $1`, [messageId]);
    expect(rows[0]?.status).toBe('sent');
  });
});
```

```ts
// apps/worker/src/jobs/daily-rollup.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { materializeDailyRollup } from './daily-rollup';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  const userId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Rollup Test', '99999999000199')`,
      [tenantId, `rl-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rl', '2077510', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Rl')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Rl', 'completo', '1990-01-01')`,
      [tenantId, patientId]);

    // Inserir pagamento de ontem
    await c.query(
      `INSERT INTO fin.payment
         (tenant_id, id, patient_id, clinic_id, amount_cents, method,
          status, created_by, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 15000, 'pix', 'confirmed', $5,
               clock_timestamp() - interval '1 day',
               clock_timestamp() - interval '1 day')`,
      [tenantId, uuidv7(), patientId, clinicId, userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('materializacao do daily_rollup', () => {
  it('agrega pagamentos do dia anterior no rollup', async () => {
    const r = await materializeDailyRollup();
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    // Verificar que o rollup foi gravado
    const { rows } = await jobsPool().query<{ entries: string; amount: string }>(
      `SELECT entries::text, amount::text FROM fin.daily_rollup
        WHERE tenant_id = $1 AND clinic_id = $2`,
      [tenantId, clinicId]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

```ts
// apps/worker/src/jobs/payment-reconciliation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { createFakePaymentProvider } from '@cadencia/integrations';
import { reconcilePayments } from './payment-reconciliation';

afterAll(async () => { await closePools(); });

describe('reconciliacao de pagamentos', () => {
  it('roda sem erro mesmo sem pagamentos PSP', async () => {
    const payment = createFakePaymentProvider();
    const r = await reconcilePayments(payment);
    expect(r.tenantsProcessed).toBeGreaterThanOrEqual(0);
    expect(typeof r.settlementsFound).toBe('number');
    expect(typeof r.divergences).toBe('number');
  });
});
```

```ts
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

describe('agendador de lembretes', () => {
  it('roda sem erro mesmo sem regras habilitadas', async () => {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL_JOBS ?? '',
      schema: 'pgboss',
    });
    await boss.start();

    const r = await scheduleReminders(boss);
    expect(r.scheduled).toBeGreaterThanOrEqual(0);
    expect(r.skipped).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] Rodar todos os testes do worker.

```bash
pnpm vitest run apps/worker/src/jobs/
# Esperado: PASS — todos os testes verdes
```

- [ ] Commitar.

```bash
git add apps/worker/src/worker.ts \
       apps/worker/src/jobs/outbox-dispatcher.ts \
       apps/worker/src/jobs/outbox-dispatcher.int.test.ts \
       apps/worker/src/jobs/send-message.ts \
       apps/worker/src/jobs/send-message.int.test.ts \
       apps/worker/src/jobs/payment-reconciliation.ts \
       apps/worker/src/jobs/payment-reconciliation.int.test.ts \
       apps/worker/src/jobs/daily-rollup.ts \
       apps/worker/src/jobs/daily-rollup.int.test.ts \
       apps/worker/src/jobs/reminder-scheduler.ts \
       apps/worker/src/jobs/reminder-scheduler.int.test.ts
git commit -m "feat(worker): add outbox dispatcher, message sending, reconciliation, rollup and reminder jobs"
```

---