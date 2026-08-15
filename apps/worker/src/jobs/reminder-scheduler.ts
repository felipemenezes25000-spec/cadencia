// apps/worker/src/jobs/reminder-scheduler.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';
import { FILA_ENVIO_LEMBRETE } from '../queues';

export interface ReminderScheduleResult {
  readonly scheduled: number;
  readonly skipped: number;
}

/**
 * Agenda SOMENTE regras de appointment_reminder.
 *
 * Antes qualquer automação ativa (NPS, pós-atendimento, aniversário etc.) era
 * tratada como lembrete de consulta. Além disso a fila de destino não existia e
 * o catch convertia a falha em "skipped", mascarando o problema.
 */
export async function scheduleReminders(boss: PgBoss): Promise<ReminderScheduleResult> {
  let scheduled = 0;
  let skipped = 0;

  const { rows: rules } = await jobsPool().query<{
    id: string; tenant_id: string; template_id: string;
    channel_identity_id: string; timing_offset_minutes: string; channel: string;
  }>(
    `SELECT r.id, r.tenant_id, r.template_id, r.channel_identity_id,
            r.timing_offset_minutes::text, r.channel
       FROM msg.automation_rule r
       JOIN msg.channel_identity ci
         ON ci.tenant_id = r.tenant_id AND ci.id = r.channel_identity_id
      WHERE r.active = true
        AND r.trigger = 'appointment_reminder'
        AND r.channel IN ('whatsapp', 'sms', 'email')
        AND ci.channel = r.channel
        AND ci.status IN ('active', 'verified')`);

  for (const rule of rules) {
    const offsetMinutes = Number(rule.timing_offset_minutes);
    if (!Number.isFinite(offsetMinutes)) {
      skipped += 1;
      continue;
    }

    const { rows: appointments } = await jobsPool().query<{
      appointment_id: string; patient_id: string; starts_at: string;
      patient_phone: string | null; patient_email: string | null;
    }>(
      `SELECT a.id AS appointment_id, a.patient_id,
              to_char(a.starts_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at,
              pat.phone_primary AS patient_phone,
              pat.email::text AS patient_email
         FROM sched.appointment a
         JOIN clin.patient pat
           ON pat.tenant_id = a.tenant_id AND pat.id = a.patient_id
        WHERE a.tenant_id = $1
          AND a.status IN ('agendado', 'confirmado')
          AND a.starts_at + make_interval(mins => $2)
              BETWEEN clock_timestamp() AND clock_timestamp() + interval '6 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM msg.sent_reminder sr
             WHERE sr.tenant_id = a.tenant_id
               AND sr.appointment_id = a.id
               AND sr.rule_id = $3
          )`,
      [rule.tenant_id, offsetMinutes, rule.id],
    );

    for (const appt of appointments) {
      const recipient = rule.channel === 'email' ? appt.patient_email : appt.patient_phone;
      if (recipient === null || recipient.trim() === '') {
        skipped += 1;
        continue;
      }

      const client = await jobsPool().connect();
      let reserved = false;
      try {
        await client.query('BEGIN');

        // Reserva antes do enqueue. A UNIQUE (tenant, appointment, rule) faz
        // dois schedulers concorrentes convergirem para um único job.
        const marcador = await client.query<{ id: string }>(
          `INSERT INTO msg.sent_reminder
             (id, tenant_id, appointment_id, rule_id, scheduled_at)
           VALUES (gen_random_uuid(), $1, $2, $3, clock_timestamp())
           ON CONFLICT (tenant_id, appointment_id, rule_id) DO NOTHING
           RETURNING id`,
          [rule.tenant_id, appt.appointment_id, rule.id],
        );

        if (marcador.rows.length === 0) {
          await client.query('ROLLBACK');
          skipped += 1;
          continue;
        }
        reserved = true;

        await boss.send(
          FILA_ENVIO_LEMBRETE,
          {
            tenantId: rule.tenant_id,
            appointmentId: appt.appointment_id,
            patientId: appt.patient_id,
            templateId: rule.template_id,
            channelIdentityId: rule.channel_identity_id,
            channelKind: rule.channel,
            ruleId: rule.id,
          },
          {
            retryLimit: 5,
            retryDelay: 30,
            retryBackoff: true,
          },
        );

        await client.query('COMMIT');
        scheduled += 1;
      } catch {
        if (reserved) {
          // Se o enqueue falhou, o ROLLBACK remove a reserva e o próximo ciclo
          // pode tentar de novo. Se o enqueue entrou e o COMMIT falhou, poderá
          // haver reentrega — at-least-once é preferível a perder o lembrete.
        }
        await client.query('ROLLBACK').catch(() => undefined);
        skipped += 1;
      } finally {
        client.release();
      }
    }
  }

  return { scheduled, skipped };
}
