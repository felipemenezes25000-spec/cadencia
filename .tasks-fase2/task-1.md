### Task 1: Tipos de evento de dominio em `packages/events`

O pacote `@cadencia/events` exporta SO tipos e constantes — sem comportamento, sem dependencias de runtime. Cada evento e um objeto imutavel com campos obrigatorios (`type`, `tenantId`, `aggregateId`, `occurredAt`, `payload`). Definimos aqui os seis tipos que a Fase 2 precisa.

**Arquivos**

- Modificar `packages/events/src/index.ts`
- Criar `packages/events/src/domain-events.ts`
- Teste `packages/events/src/domain-events.test.ts`

---

- [ ] **Passo 1 — teste que falha: evento tipado respeita o contrato**

Criar `packages/events/src/domain-events.test.ts`:

```ts
// packages/events/src/domain-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
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
    const { isEventType } = require('./domain-events') as typeof import('./domain-events');
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
```

Rodar:

```bash
pnpm vitest run packages/events/src/domain-events.test.ts
```

Saida esperada: falha — modulo `./domain-events` nao existe.

---

- [ ] **Passo 2 — implementar os tipos de evento**

Criar `packages/events/src/domain-events.ts`:

```ts
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
```

---

- [ ] **Passo 3 — reexportar pelo barrel**

Modificar `packages/events/src/index.ts`:

```ts
// packages/events/src/index.ts
export {
  EVENT_TYPES, isEventType,
  type EventType,
  type DomainEvent,
  type DomainEventBase,
  type AppointmentConfirmed,
  type AppointmentConfirmedPayload,
  type AppointmentReminderDue,
  type AppointmentReminderDuePayload,
  type EncounterFinalized,
  type EncounterFinalizedPayload,
  type PaymentReceived,
  type PaymentReceivedPayload,
  type PaymentLinkCreated,
  type PaymentLinkCreatedPayload,
  type InboundMessageReceived,
  type InboundMessageReceivedPayload,
} from './domain-events';
```

Rodar:

```bash
pnpm vitest run packages/events/src/domain-events.test.ts
```

Saida esperada: 4 testes passando.

---

- [ ] **Passo 4 — verificar que arch:check passa**

```bash
pnpm arch:check
```

Saida esperada: sem violacao. `@cadencia/events` e L0 e nao importa ninguem.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/events/src/domain-events.ts packages/events/src/domain-events.test.ts packages/events/src/index.ts
git commit -m "feat(events): typed domain events for Phase 2

Define the 6 event types (APPOINTMENT_CONFIRMED, APPOINTMENT_REMINDER_DUE,
ENCOUNTER_FINALIZED, PAYMENT_RECEIVED, PAYMENT_LINK_CREATED,
INBOUND_MESSAGE_RECEIVED) as a discriminated union with typed payloads.
The package exports only types and constants — no behavior, no deps.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---