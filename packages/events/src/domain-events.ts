// packages/events/src/domain-events.ts

/**
 * §7.1 — Eventos de dominio tipados.
 *
 * Cada evento e um objeto imutavel com cinco campos obrigatorios.
 * O pacote exporta SO tipos e constantes — sem comportamento, sem
 * dependencias de runtime. Quem consome e o outbox (L0) e o worker (L3).
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Contrato base
// ---------------------------------------------------------------------------

export interface DomainEventBase<T extends EventType, P> {
  readonly type: T;
  readonly tenantId: string;
  /** Identificador do agregado de origem (appointment, encounter, payment, etc.) */
  readonly aggregateId: string;
  /** ISO 8601 UTC com ms — fonte de tempo e clock_timestamp() do Postgres */
  readonly occurredAt: string;
  readonly payload: P;
}

// ---------------------------------------------------------------------------
// Payloads individuais
// ---------------------------------------------------------------------------

export interface AppointmentConfirmedPayload {
  readonly appointmentId: string;
  readonly confirmedBy: 'patient' | 'clinic';
}

export interface AppointmentReminderDuePayload {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly startsAt: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
}

export interface EncounterFinalizedPayload {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly versionNo: number;
}

export interface PaymentReceivedPayload {
  readonly paymentId: string;
  readonly amountCents: number;
  readonly method: string;
}

export interface PaymentLinkCreatedPayload {
  readonly paymentLinkId: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export interface InboundMessageReceivedPayload {
  readonly conversationId: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly fromPhone: string;
}

// ---------------------------------------------------------------------------
// Tipos concretos
// ---------------------------------------------------------------------------

export type AppointmentConfirmed = DomainEventBase<'APPOINTMENT_CONFIRMED', AppointmentConfirmedPayload>;
export type AppointmentReminderDue = DomainEventBase<'APPOINTMENT_REMINDER_DUE', AppointmentReminderDuePayload>;
export type EncounterFinalized = DomainEventBase<'ENCOUNTER_FINALIZED', EncounterFinalizedPayload>;
export type PaymentReceived = DomainEventBase<'PAYMENT_RECEIVED', PaymentReceivedPayload>;
export type PaymentLinkCreated = DomainEventBase<'PAYMENT_LINK_CREATED', PaymentLinkCreatedPayload>;
export type InboundMessageReceived = DomainEventBase<'INBOUND_MESSAGE_RECEIVED', InboundMessageReceivedPayload>;

// ---------------------------------------------------------------------------
// Uniao discriminada
// ---------------------------------------------------------------------------

export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived;
