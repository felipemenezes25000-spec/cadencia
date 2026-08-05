// packages/events/src/domain-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  isEventType,
  type DomainEvent,
  type AppointmentConfirmed,
  type AppointmentReminderDue,
  type EncounterFinalized,
  type PaymentReceived,
  type PaymentLinkCreated,
  type InboundMessageReceived,
} from './domain-events';

describe('eventos de dominio', () => {
  it('EVENT_TYPES contem exatamente os 6 tipos da Fase 2', () => {
    expect(EVENT_TYPES).toEqual([
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER_DUE',
      'ENCOUNTER_FINALIZED',
      'PAYMENT_RECEIVED',
      'PAYMENT_LINK_CREATED',
      'INBOUND_MESSAGE_RECEIVED',
    ]);
  });

  it('isEventType aceita tipo valido e recusa invalido', () => {
    expect(isEventType('APPOINTMENT_CONFIRMED')).toBe(true);
    expect(isEventType('NAO_EXISTE')).toBe(false);
    expect(isEventType('')).toBe(false);
  });

  it('construcao de evento tipado satisfaz DomainEvent', () => {
    const evt: AppointmentConfirmed = {
      type: 'APPOINTMENT_CONFIRMED',
      tenantId: '00000000-0000-0000-0000-000000000001',
      aggregateId: '00000000-0000-0000-0000-000000000002',
      occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: '00000000-0000-0000-0000-000000000002', confirmedBy: 'patient' },
    };
    // satisfaz a uniao DomainEvent
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('APPOINTMENT_CONFIRMED');
  });

  it('cada tipo de evento tem payload distinto', () => {
    const reminder: AppointmentReminderDue = {
      type: 'APPOINTMENT_REMINDER_DUE',
      tenantId: 't1', aggregateId: 'a1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: 'a1', patientId: 'p1', startsAt: '2026-08-05T14:00:00.000Z',
                 channel: 'whatsapp' },
    };
    const finalized: EncounterFinalized = {
      type: 'ENCOUNTER_FINALIZED',
      tenantId: 't1', aggregateId: 'e1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { encounterId: 'e1', patientId: 'p1', professionalId: 'pr1', versionNo: 1 },
    };
    const paid: PaymentReceived = {
      type: 'PAYMENT_RECEIVED',
      tenantId: 't1', aggregateId: 'pay1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentId: 'pay1', amountCents: 25000, method: 'pix' },
    };
    const link: PaymentLinkCreated = {
      type: 'PAYMENT_LINK_CREATED',
      tenantId: 't1', aggregateId: 'link1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentLinkId: 'link1', amountCents: 25000, expiresAt: '2026-08-05T10:00:00.000Z' },
    };
    const inbound: InboundMessageReceived = {
      type: 'INBOUND_MESSAGE_RECEIVED',
      tenantId: 't1', aggregateId: 'msg1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { conversationId: 'conv1', channel: 'whatsapp', fromPhone: '+5511999990000' },
    };
    expect(reminder.type).toBe('APPOINTMENT_REMINDER_DUE');
    expect(finalized.payload.versionNo).toBe(1);
    expect(paid.payload.amountCents).toBe(25000);
    expect(link.payload.expiresAt).toBe('2026-08-05T10:00:00.000Z');
    expect(inbound.payload.fromPhone).toBe('+5511999990000');
  });
});
