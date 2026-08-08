### Task 28: Evento ENCOUNTER_AMENDED em domain-events.ts

**Arquivos**

- Modificar: `packages/events/src/domain-events.ts`
- Modificar: `packages/events/src/domain-events.test.ts`

**Passos**

- [ ] Escrever o teste que falha: atualizar `packages/events/src/domain-events.test.ts` para esperar 11 tipos (era 10) incluindo `ENCOUNTER_AMENDED`, e verificar que o payload carrega `kind`.

```typescript
// Em packages/events/src/domain-events.test.ts
// SUBSTITUIR o import inteiro no topo do arquivo:
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

// SUBSTITUIR o primeiro it():
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

// SUBSTITUIR o it('isEventType aceita tipo valido...'):
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

// ADICIONAR ao final do describe, antes do fechamento:
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
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd packages/events && pnpm vitest run src/domain-events.test.ts
# Esperado: falha em "EVENT_TYPES contem exatamente os 11 tipos" e em import de EncounterAmended
```

- [ ] Implementar: adicionar `ENCOUNTER_AMENDED` ao `packages/events/src/domain-events.ts`.

```typescript
// Em packages/events/src/domain-events.ts

// SUBSTITUIR o array EVENT_TYPES inteiro:
export const EVENT_TYPES = [
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
] as const;

// ADICIONAR apos EncounterFinalizedPayload:
export interface EncounterAmendedPayload {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly versionNo: number;
  /** 'retificacao' ou 'adendo' — o handler de reprojecao usa para decidir o fluxo */
  readonly kind: 'retificacao' | 'adendo';
}

// ADICIONAR apos a linha "export type EncounterFinalized = ...":
export type EncounterAmended = DomainEventBase<'ENCOUNTER_AMENDED', EncounterAmendedPayload>;

// SUBSTITUIR a uniao DomainEvent inteira (adicionar EncounterAmended):
export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | EncounterAmended
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | SplitCalculated
  | StockAlertTriggered
  | RepasseClosed
  | RecurringEntryMaterialized;
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd packages/events && pnpm vitest run src/domain-events.test.ts
# Esperado: 8 testes, 0 falhas
```

- [ ] Commitar:

```bash
git add packages/events/src/domain-events.ts packages/events/src/domain-events.test.ts
git commit -m "feat(events): add ENCOUNTER_AMENDED domain event for Fase 4 reprojecao"
```

---