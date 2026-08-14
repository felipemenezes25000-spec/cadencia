/**
 * Handler de confirmação de agendamento.
 *
 * Recebe os dados do agendamento JÁ RESOLVIDOS (por L3/worker) e as regras de
 * automação do tenant. Retorna as entradas de outbox a serem enfileiradas.
 *
 * O messaging NÃO importa scheduling — a composição é pelo worker/L3.
 */

/**
 * Gatilhos de automação. Espelha o CHECK de msg.automation_rule (migration
 * 0182) — se divergir, a regra é aceita no app e recusada pelo banco.
 *
 * `exigeConsentimentoDeMarketing` abaixo diz quais NÃO se apoiam na tutela da
 * saúde e precisam de consentimento LGPD próprio.
 */
export type AutomationTrigger =
  | 'appointment_created'
  | 'appointment_reminder'
  | 'encounter_finalized'
  | 'nps_due'
  | 'appointment_no_show'
  | 'patient_birthday'
  | 'patient_inactive'
  | 'recall_due'
  | 'payment_overdue';

export const AUTOMATION_TRIGGERS: readonly AutomationTrigger[] = [
  'appointment_created',
  'appointment_reminder',
  'encounter_finalized',
  'nps_due',
  'appointment_no_show',
  'patient_birthday',
  'patient_inactive',
  'recall_due',
  'payment_overdue',
];

/**
 * Aniversário e reativação são relacionamento/marketing: o tratamento não cabe
 * na base legal de tutela da saúde (LGPD art. 7, VIII) e exige consentimento
 * do titular com finalidade 'marketing' (app.lgpd_consent).
 *
 * Lembrete, confirmação, retorno clínico e cobrança de título vencido são
 * execução do próprio atendimento ou do contrato — não dependem de consentimento
 * separado.
 */
export function exigeConsentimentoDeMarketing(t: AutomationTrigger): boolean {
  return t === 'patient_birthday' || t === 'patient_inactive';
}

export interface AutomationRule {
  readonly id: string;
  readonly tenantId: string;
  readonly trigger: AutomationTrigger;
  readonly templateId: string;
  readonly timingOffsetMinutes: number;
  readonly active: boolean;
  readonly channel: 'whatsapp' | 'sms' | 'email';
}

export interface AppointmentCreatedPayload {
  readonly tenantId: string;
  readonly appointmentId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
  readonly professionalName: string;
  readonly clinicId: string;
  readonly clinicTimezone: string;
  readonly startsAt: string;
  readonly appointmentDate: string;
  readonly procedureName: string | null;
}

export interface ConfirmationOutboxEntry {
  readonly eventType: 'SEND_CONFIRMATION';
  readonly aggregateId: string;
  readonly payload: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
      readonly appointmentDate: string;
      readonly procedureName: string;
      readonly startsAt: string;
    };
  };
}

export function handleAppointmentCreated(
  appt: AppointmentCreatedPayload,
  rules: readonly AutomationRule[],
): ConfirmationOutboxEntry[] {
  if (appt.patientPhone === null || appt.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'appointment_created' && r.active && r.tenantId === appt.tenantId,
  );

  return matching.map((rule) => ({
    eventType: 'SEND_CONFIRMATION' as const,
    aggregateId: appt.appointmentId,
    payload: {
      tenantId: appt.tenantId,
      appointmentId: appt.appointmentId,
      patientId: appt.patientId,
      to: appt.patientPhone!,
      templateId: rule.templateId,
      channel: rule.channel,
      variables: {
        patientName: appt.patientName,
        professionalName: appt.professionalName,
        appointmentDate: appt.appointmentDate,
        procedureName: appt.procedureName ?? 'Consulta',
        startsAt: appt.startsAt,
      },
    },
  }));
}
