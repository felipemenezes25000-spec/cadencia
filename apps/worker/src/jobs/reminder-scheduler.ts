// apps/worker/src/jobs/reminder-scheduler.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

export interface ReminderScheduleResult {
  readonly scheduled: number;
  readonly skipped: number;
}

/**
 * Agenda lembretes e confirmações automáticas.
 *
 * Varre msg.automation_rule para regras habilitadas, encontra agendamentos
 * que se encaixam no critério de offset e agenda jobs de envio.
 *
 * Divergências do plano vs schema real:
 * - active (não enabled)
 * - timing_offset_minutes (não offset_minutes)
 * - channel (não channel_kind)
 */
export async function scheduleReminders(boss: PgBoss): Promise<ReminderScheduleResult> {
  let scheduled = 0;
  let skipped = 0;

  // Buscar regras ativas (coluna real: active, não enabled)
  const { rows: rules } = await jobsPool().query<{
    id: string; tenant_id: string; trigger: string; template_id: string;
    timing_offset_minutes: string; channel: string;
  }>(
    `SELECT r.id, r.tenant_id, r.trigger, r.template_id,
            r.timing_offset_minutes::text, r.channel
       FROM msg.automation_rule r
      WHERE r.active = true`);

  for (const rule of rules) {
    const offsetMinutes = Number(rule.timing_offset_minutes);

    // Buscar agendamentos que precisam de lembrete/confirmação.
    // O offset negativo significa "antes do agendamento".
    // Ex: timing_offset_minutes = -1440 significa 24h antes.
    // Colunas reais: patient.phone_primary, patient.full_name
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
             WHERE sr.tenant_id = a.tenant_id
               AND sr.appointment_id = a.id AND sr.rule_id = $3
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
          channelKind: rule.channel,
          ruleId: rule.id,
        });

        // Marcar como agendado para não duplicar
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
