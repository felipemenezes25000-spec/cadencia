/**
 * Automações pós-atendimento: acompanhamento e NPS.
 *
 * Pós-consulta: trigger `encounter_finalized`, template de acompanhamento
 * enviado N minutos após finalização (tipicamente 24h = 1440 min).
 *
 * NPS: trigger `nps_due`, template com escala 0-10 enviado N minutos após
 * finalização (tipicamente 7 dias = 10080 min). A resposta do paciente é
 * parseada e gravada em `msg.nps_response` pelo worker.
 */

import { computeReminderInstant } from './reminder-timing';
import type { AutomationRule } from './confirmation';

export interface EncounterFinalizedPayload {
  readonly tenantId: string;
  readonly encounterId: string;
  readonly appointmentId: string | null;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
  readonly professionalName: string;
  readonly clinicId: string;
  readonly clinicTimezone: string;
  /** Instante UTC da finalização. */
  readonly finalizedAt: string;
}

export interface PostEncounterOutboxEntry {
  readonly eventType: 'SEND_POST_ENCOUNTER';
  readonly aggregateId: string;
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly encounterId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
    };
  };
}

export interface NpsOutboxEntry {
  readonly eventType: 'SEND_NPS';
  readonly aggregateId: string;
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly encounterId: string;
    readonly appointmentId: string | null;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
    };
  };
}

export function handleEncounterFinalized(
  enc: EncounterFinalizedPayload,
  rules: readonly AutomationRule[],
): PostEncounterOutboxEntry[] {
  if (enc.patientPhone === null || enc.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'encounter_finalized' && r.active && r.tenantId === enc.tenantId,
  );

  return matching.map((rule) => {
    const startAfter = computeReminderInstant(
      enc.finalizedAt,
      enc.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    return {
      eventType: 'SEND_POST_ENCOUNTER' as const,
      aggregateId: enc.encounterId,
      startAfter,
      payload: {
        tenantId: enc.tenantId,
        encounterId: enc.encounterId,
        patientId: enc.patientId,
        to: enc.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        variables: {
          patientName: enc.patientName,
          professionalName: enc.professionalName,
        },
      },
    };
  });
}

export function scheduleNps(
  enc: EncounterFinalizedPayload,
  rules: readonly AutomationRule[],
): NpsOutboxEntry[] {
  if (enc.patientPhone === null || enc.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'nps_due' && r.active && r.tenantId === enc.tenantId,
  );

  return matching.map((rule) => {
    const startAfter = computeReminderInstant(
      enc.finalizedAt,
      enc.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    return {
      eventType: 'SEND_NPS' as const,
      aggregateId: enc.encounterId,
      startAfter,
      payload: {
        tenantId: enc.tenantId,
        encounterId: enc.encounterId,
        appointmentId: enc.appointmentId,
        patientId: enc.patientId,
        to: enc.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        variables: {
          patientName: enc.patientName,
          professionalName: enc.professionalName,
        },
      },
    };
  });
}
