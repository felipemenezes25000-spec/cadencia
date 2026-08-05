/**
 * Agenda lembretes de consulta.
 *
 * Para cada automation_rule com trigger `appointment_reminder`, calcula o
 * instante de envio no fuso da clinica e retorna entradas de outbox com
 * `startAfter` para que o pg-boss agende o job no momento correto.
 *
 * Fallback SMS (design §9): se o canal primario e WhatsApp e o envio falhar,
 * o worker tenta por SMS. O fallback e declarado na entrada de outbox para
 * que o despachante saiba o que fazer.
 */

import { systemClock } from '@cadencia/kernel';
import { computeReminderInstant } from './reminder-timing';
import type { AutomationRule, AppointmentCreatedPayload } from './confirmation';

export interface ReminderOutboxEntry {
  readonly eventType: 'SEND_REMINDER';
  readonly aggregateId: string;
  /** Instante UTC em que o pg-boss deve disparar o job. */
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    /** Canal de fallback se o primario falhar. Null se nao ha fallback. */
    readonly fallbackChannel: 'sms' | null;
    readonly ruleId: string;
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
      readonly appointmentDate: string;
      readonly procedureName: string;
      readonly startsAt: string;
    };
  };
}

export function scheduleReminders(
  appt: AppointmentCreatedPayload,
  rules: readonly AutomationRule[],
  nowMs: number = systemClock.nowMs(),
): ReminderOutboxEntry[] {
  if (appt.patientPhone === null || appt.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'appointment_reminder' && r.active && r.tenantId === appt.tenantId,
  );

  const entries: ReminderOutboxEntry[] = [];

  for (const rule of matching) {
    const startAfter = computeReminderInstant(
      appt.startsAt,
      appt.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    // Descarta lembretes cujo instante de envio ja passou
    const startAfterMs = Date.parse(startAfter);
    if (startAfterMs <= nowMs) {
      continue;
    }

    // Fallback SMS: so quando o canal primario e WhatsApp (design §9)
    const fallbackChannel: 'sms' | null = rule.channel === 'whatsapp' ? 'sms' : null;

    entries.push({
      eventType: 'SEND_REMINDER',
      aggregateId: appt.appointmentId,
      startAfter,
      payload: {
        tenantId: appt.tenantId,
        appointmentId: appt.appointmentId,
        patientId: appt.patientId,
        to: appt.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        fallbackChannel,
        ruleId: rule.id,
        variables: {
          patientName: appt.patientName,
          professionalName: appt.professionalName,
          appointmentDate: appt.appointmentDate,
          procedureName: appt.procedureName ?? 'Consulta',
          startsAt: appt.startsAt,
        },
      },
    });
  }

  return entries;
}
