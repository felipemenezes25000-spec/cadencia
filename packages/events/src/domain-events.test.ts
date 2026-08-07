// packages/events/src/domain-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  isEventType,
  type DomainEvent,
  type AppointmentConfirmed,
  type AppointmentReminderDue,
  type EncounterFinalized,
  type EncounterAmended,
  type PaymentReceived,
  type PaymentLinkCreated,
  type InboundMessageReceived,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from './domain-events';

describe('eventos de dominio', () => {
  it('EVENT_TYPES contem exatamente os 11 tipos ate a Fase 4', () => {
    expect(EVENT_TYPES).toEqual([
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER_DUE',
      'ENCOUNTER_FINALIZED',
      'ENCOUNTER_AMENDED',
      'PAYMENT_RECEIVED',
      'PAYMENT_LINK_CREATED',
      'INBOUND_MESSAGE_RECEIVED',
      'SPLIT_CALCULATED',
      'STOCK_ALERT_TRIGGERED',
      'REPASSE_CLOSED',
      'RECURRING_ENTRY_MATERIALIZED',
    ]);
  });

  it('isEventType aceita tipo valido e recusa invalido', () => {
    expect(isEventType('APPOINTMENT_CONFIRMED')).toBe(true);
    expect(isEventType('ENCOUNTER_AMENDED')).toBe(true);
    expect(isEventType('SPLIT_CALCULATED')).toBe(true);
    expect(isEventType('STOCK_ALERT_TRIGGERED')).toBe(true);
    expect(isEventType('REPASSE_CLOSED')).toBe(true);
    expect(isEventType('RECURRING_ENTRY_MATERIALIZED')).toBe(true);
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
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('APPOINTMENT_CONFIRMED');
  });

  it('cada tipo de evento da Fase 2 tem payload distinto', () => {
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

  it('SPLIT_CALCULATED carrega o percentual e os centavos bruto e liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { entryId: 'entry1', professionalId: 'prof1',
                 grossCents: 30000, netCents: 12000, splitPct: 40 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
    expect(evt.payload.netCents).toBe(12000);
    expect(evt.payload.splitPct).toBe(40);
  });

  it('STOCK_ALERT_TRIGGERED carrega quantidade atual e minima', () => {
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
  });

  it('REPASSE_CLOSED carrega periodo e total em centavos', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { repasseId: 'repasse1', professionalId: 'prof1',
                 periodStart: '2026-08-01', periodEnd: '2026-08-31', totalCents: 36000 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.totalCents).toBe(36000);
  });

  it('RECURRING_ENTRY_MATERIALIZED carrega a regra de origem e a data de vencimento', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { recurringRuleId: 'rule1', entryId: 'entry2',
                 amountCents: 89000, dueDate: '2026-09-05' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.dueDate).toBe('2026-09-05');
  });

  it('ENCOUNTER_AMENDED carrega kind e versionNo', () => {
    const evt: EncounterAmended = {
      type: 'ENCOUNTER_AMENDED',
      tenantId: 't1', aggregateId: 'e1', occurredAt: '2026-08-07T10:00:00.000Z',
      payload: {
        encounterId: 'e1', patientId: 'p1', professionalId: 'pr1',
        versionNo: 2, kind: 'retificacao',
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('ENCOUNTER_AMENDED');
    expect(evt.payload.kind).toBe('retificacao');
    expect(evt.payload.versionNo).toBe(2);
  });
});
