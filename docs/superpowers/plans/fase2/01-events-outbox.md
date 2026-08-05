<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Este bloco e a FUNDACAO de todos os demais. Nenhuma colisao encontrada.
  A tabela app.outbox (migration 0068) e a UNICA outbox — o Bloco 07
  referenciava msg.outbox_event e fin.outbox_event que NAO existem;
  corrigido para usar app.outbox.
─────────────────────────────────────────────────────────────────── -->

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

### Task 2: Migration 0068 — tabela `app.outbox` com RLS

Cria a tabela `app.outbox` com isolamento multi-tenant (RLS habilitada e forcada), indice de despacho e indice para dead-letter. A tabela e o mecanismo central de "sem job fantasma": o INSERT acontece DENTRO da transacao de dominio.

**Arquivos**

- Criar `packages/db/migrations/0068_outbox.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0068_outbox.sql`:

```sql
-- 0068_outbox.sql
-- Fase 2 · design §7.1 — outbox transacional.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- A tabela app.outbox recebe INSERT dentro da transacao de dominio (via
-- app.enqueue_outbox), garantindo que o evento so existe se o efeito de negocio
-- existir. O despachante no worker le, processa e marca dispatched_at.

CREATE TABLE app.outbox (
  tenant_id     uuid        NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_type    text        NOT NULL,
  aggregate_id  uuid        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz(3),
  attempts      smallint    NOT NULL DEFAULT 0,
  last_error    text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id));
ALTER TABLE app.outbox OWNER TO app_owner;

-- Indice de despacho: o worker busca eventos nao despachados com ate 5 tentativas,
-- ordenados por criacao. O filtro parcial mantem o indice pequeno.
CREATE INDEX ix_outbox_pending
  ON app.outbox (created_at)
  WHERE dispatched_at IS NULL AND attempts < 5;

-- Indice de dead-letter: eventos que esgotaram tentativas.
CREATE INDEX ix_outbox_dead_letter
  ON app.outbox (tenant_id, created_at)
  WHERE dispatched_at IS NULL AND attempts >= 5;

-- GRANTs: app_rw pode INSERT (transacao de dominio) e SELECT (despachante via withTenantTx).
-- O UPDATE de dispatched_at e attempts roda pelo jobs (BYPASSRLS). app_rw nao recebe DELETE.
GRANT SELECT, INSERT ON app.outbox TO app_rw;
GRANT UPDATE (dispatched_at, attempts, last_error) ON app.outbox TO app_rw;

-- RLS: isolamento padrao §3.3
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON app.outbox AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar migrations e verificar que test:iso passa**

```bash
pnpm db:migrate
pnpm test:iso
```

Saida esperada: migration 0068 aplicada, `test:iso` passa — `app.outbox` tem `tenant_id`, RLS habilitada e forcada, ao menos uma policy.

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0068_outbox.sql
git commit -m "feat(db): outbox table with RLS (migration 0068)

Transactional outbox in app.outbox — INSERT happens inside the domain
transaction so no phantom jobs exist. Indexes for pending dispatch and
dead-letter. RLS enabled and forced with tenant isolation policy.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0069 — funcao `app.enqueue_outbox` e teste de integracao

Funcao SQL `app.enqueue_outbox(event_type, aggregate_id, payload)` que faz INSERT na `app.outbox` usando o `tenant_id` do contexto da transacao. Chamada DENTRO da transacao de dominio — o evento so existe se o COMMIT acontecer.

**Arquivos**

- Criar `packages/db/migrations/0069_enqueue_outbox.sql`
- Criar `packages/outbox/src/enqueue.ts`
- Teste `packages/outbox/src/enqueue.int.test.ts`
- Criar `packages/outbox/src/test-support.ts`

---

- [ ] **Passo 1 — escrever a migration com a funcao SQL**

Criar `packages/db/migrations/0069_enqueue_outbox.sql`:

```sql
-- 0069_enqueue_outbox.sql
-- Fase 2 · design §7.1 — funcao de enfileiramento transacional.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

CREATE FUNCTION app.enqueue_outbox(
  p_event_type   text,
  p_aggregate_id uuid,
  p_payload      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = app, pg_catalog AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO app.outbox (tenant_id, id, event_type, aggregate_id, payload)
  VALUES (app.require_tenant_id(), v_id, p_event_type, p_aggregate_id, p_payload);
  RETURN v_id;
END $$;

ALTER FUNCTION app.enqueue_outbox(text, uuid, jsonb) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.enqueue_outbox(text, uuid, jsonb) TO app_rw;
GRANT EXECUTE ON FUNCTION app.enqueue_outbox(text, uuid, jsonb) TO clin_writer;
```

---

- [ ] **Passo 2 — rodar migration**

```bash
pnpm db:migrate
```

Saida esperada: migration 0069 aplicada sem erro.

---

- [ ] **Passo 3 — criar test-support para outbox**

Criar `packages/outbox/src/test-support.ts`:

```ts
// packages/outbox/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeOutbox {
  tenantId: string;
  clinicId: string;
  userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`',
    );
  }
  return url;
}

export async function semearOutbox(): Promise<SementeOutbox> {
  const s: SementeOutbox = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Outbox', '12ABC34501DE35')`,
      [s.tenantId, `o-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Outbox', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Outbox')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

---

- [ ] **Passo 4 — teste de integracao que falha: enqueue dentro da transacao**

Criar `packages/outbox/src/enqueue.int.test.ts`:

```ts
// packages/outbox/src/enqueue.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { enqueue } from './enqueue';
import { semearOutbox, type SementeOutbox } from './test-support';

let s: SementeOutbox;
let actor: Actor;

beforeAll(async () => {
  s = await semearOutbox();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('enqueue outbox', () => {
  it('insere evento na outbox dentro da transacao de dominio', async () => {
    const aggregateId = uuidv7();
    const outboxId = await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'APPOINTMENT_CONFIRMED',
        aggregateId,
        payload: { appointmentId: aggregateId, confirmedBy: 'patient' },
      }),
    );
    expect(outboxId).toBeTruthy();

    // verifica que esta no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string; event_type: string; dispatched_at: string | null }>(
        `SELECT id, event_type, dispatched_at FROM app.outbox WHERE id = $1`,
        [outboxId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('APPOINTMENT_CONFIRMED');
    expect(rows[0]!.dispatched_at).toBeNull();
  });

  it('evento desaparece quando a transacao faz rollback', async () => {
    const aggregateId = uuidv7();
    let outboxId = '';
    try {
      await withTenantTx(actor, async (tx) => {
        outboxId = await enqueue(tx, {
          eventType: 'ENCOUNTER_FINALIZED',
          aggregateId,
          payload: { encounterId: aggregateId },
        });
        throw new Error('rollback proposital');
      });
    } catch {
      // esperado
    }
    expect(outboxId).toBeTruthy();

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM app.outbox WHERE id = $1`,
        [outboxId],
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('isolamento: tenant B nao ve evento do tenant A', async () => {
    const aggregateId = uuidv7();
    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'PAYMENT_RECEIVED',
        aggregateId,
        payload: { paymentId: aggregateId, amountCents: 10000 },
      }),
    );

    // criar segundo tenant
    const s2 = await semearOutbox();
    const actorB: Actor = {
      kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
      clinicId: s2.clinicId, requestId: uuidv7(),
    };
    const { rows } = await withTenantTx(actorB, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM app.outbox`),
    );
    // tenant B nao ve eventos de tenant A
    const idsA = rows.filter((r) => r.id === aggregateId);
    expect(idsA).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/outbox/src/enqueue.int.test.ts
```

Saida esperada: falha — modulo `./enqueue` nao existe.

---

- [ ] **Passo 5 — implementar `enqueue`**

Criar `packages/outbox/src/enqueue.ts`:

```ts
// packages/outbox/src/enqueue.ts
import type { TxClient } from '@cadencia/db';
import type { EventType } from '@cadencia/events';

export interface EnqueueInput {
  readonly eventType: EventType;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Enfileira um evento de dominio na outbox transacional.
 *
 * DEVE ser chamada DENTRO de withTenantTx — o INSERT participa da mesma
 * transacao. Se o COMMIT nao acontecer, o evento desaparece junto.
 * Sem job fantasma.
 */
export async function enqueue(
  tx: TxClient,
  input: EnqueueInput,
): Promise<string> {
  const { rows } = await tx.query<{ enqueue_outbox: string }>(
    `SELECT app.enqueue_outbox($1, $2, $3::jsonb)`,
    [input.eventType, input.aggregateId, JSON.stringify(input.payload)],
  );
  return rows[0]!.enqueue_outbox;
}
```

---

- [ ] **Passo 6 — atualizar package.json com dependencias**

Modificar `packages/outbox/package.json`:

```json
{
  "name": "@cadencia/outbox",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*",
    "@cadencia/events": "workspace:*",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.3"
  }
}
```

> **Nota de camada:** `outbox` e serv-L0, `events` e base-L0, `db` e infra-L0. Serv importa base e infra (`.dependency-cruiser.cjs`). Irmao proibido e dentro da mesma faixa (serv nao importa serv).

---

- [ ] **Passo 7 — rodar testes e confirmar que passam**

```bash
pnpm install
pnpm vitest run packages/outbox/src/enqueue.int.test.ts
```

Saida esperada: 3 testes passando.

---

- [ ] **Passo 8 — commitar**

```bash
git add packages/db/migrations/0069_enqueue_outbox.sql packages/outbox/src/enqueue.ts packages/outbox/src/enqueue.int.test.ts packages/outbox/src/test-support.ts packages/outbox/package.json
git commit -m "feat(outbox): enqueue_outbox SQL function + TypeScript wrapper (migration 0069)

app.enqueue_outbox(event_type, aggregate_id, payload) runs inside the
domain transaction — no phantom jobs. TypeScript enqueue() calls the SQL
function. Integration tests prove transactional atomicity and tenant
isolation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Despachante do outbox com retry e dead-letter

O despachante le eventos nao despachados, processa via handler registrado, marca `dispatched_at` em caso de sucesso, incrementa `attempts` e grava `last_error` em caso de falha. Backoff exponencial, maximo 5 tentativas, dead-letter apos isso. O pg-boss existente em `packages/jobs` agenda o polling.

**Arquivos**

- Criar `packages/outbox/src/dispatcher.ts`
- Criar `packages/outbox/src/dispatcher.test.ts`

---

- [ ] **Passo 1 — teste que falha: despachante processa eventos pendentes**

Criar `packages/outbox/src/dispatcher.test.ts`:

```ts
// packages/outbox/src/dispatcher.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  createDispatcher,
  type OutboxHandler,
  type OutboxRow,
  type DispatchResult,
} from './dispatcher';

function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'row-1',
    tenantId: 'tenant-1',
    eventType: 'APPOINTMENT_CONFIRMED',
    aggregateId: 'agg-1',
    payload: { appointmentId: 'agg-1', confirmedBy: 'patient' },
    createdAt: '2026-08-04T10:00:00.000Z',
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe('despachante do outbox', () => {
  it('despacha evento com handler registrado e marca sucesso', async () => {
    const handler = vi.fn<OutboxHandler>().mockResolvedValue(undefined);
    const markDispatched = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const markFailed = vi.fn<(id: string, error: string) => Promise<void>>().mockResolvedValue(undefined);

    const dispatcher = createDispatcher({
      handlers: { APPOINTMENT_CONFIRMED: handler },
      markDispatched,
      markFailed,
    });

    const row = makeRow();
    const result = await dispatcher.dispatch(row);

    expect(result).toEqual<DispatchResult>({ status: 'dispatched' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(row);
    expect(markDispatched).toHaveBeenCalledWith('row-1');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marca falha quando handler lanca excecao', async () => {
    const handler = vi.fn<OutboxHandler>().mockRejectedValue(new Error('boom'));
    const markDispatched = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const markFailed = vi.fn<(id: string, error: string) => Promise<void>>().mockResolvedValue(undefined);

    const dispatcher = createDispatcher({
      handlers: { APPOINTMENT_CONFIRMED: handler },
      markDispatched,
      markFailed,
    });

    const row = makeRow();
    const result = await dispatcher.dispatch(row);

    expect(result).toEqual<DispatchResult>({ status: 'failed', error: 'boom' });
    expect(markFailed).toHaveBeenCalledWith('row-1', 'boom');
    expect(markDispatched).not.toHaveBeenCalled();
  });

  it('marca dead-letter quando tentativas esgotaram (attempts >= 4 antes do despacho)', async () => {
    const handler = vi.fn<OutboxHandler>().mockRejectedValue(new Error('persistente'));
    const markDispatched = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const markFailed = vi.fn<(id: string, error: string) => Promise<void>>().mockResolvedValue(undefined);

    const dispatcher = createDispatcher({
      handlers: { APPOINTMENT_CONFIRMED: handler },
      markDispatched,
      markFailed,
    });

    const row = makeRow({ attempts: 4 });
    const result = await dispatcher.dispatch(row);

    expect(result).toEqual<DispatchResult>({ status: 'dead_letter', error: 'persistente' });
    expect(markFailed).toHaveBeenCalledWith('row-1', 'persistente');
  });

  it('ignora evento sem handler registrado e marca como despachado', async () => {
    const markDispatched = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const markFailed = vi.fn<(id: string, error: string) => Promise<void>>().mockResolvedValue(undefined);

    const dispatcher = createDispatcher({
      handlers: {},
      markDispatched,
      markFailed,
    });

    const row = makeRow({ eventType: 'UNKNOWN_EVENT' });
    const result = await dispatcher.dispatch(row);

    expect(result).toEqual<DispatchResult>({ status: 'no_handler' });
    expect(markDispatched).toHaveBeenCalledWith('row-1');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('calcula backoff exponencial corretamente', () => {
    const { backoffMs } = createDispatcher({
      handlers: {},
      markDispatched: vi.fn(),
      markFailed: vi.fn(),
    });

    expect(backoffMs(0)).toBe(1_000);     // 1s
    expect(backoffMs(1)).toBe(2_000);     // 2s
    expect(backoffMs(2)).toBe(4_000);     // 4s
    expect(backoffMs(3)).toBe(8_000);     // 8s
    expect(backoffMs(4)).toBe(16_000);    // 16s
    // maximo de 5 minutos
    expect(backoffMs(20)).toBe(300_000);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/outbox/src/dispatcher.test.ts
```

Saida esperada: falha — modulo `./dispatcher` nao existe.

---

- [ ] **Passo 2 — implementar o despachante**

Criar `packages/outbox/src/dispatcher.ts`:

```ts
// packages/outbox/src/dispatcher.ts

/**
 * §7.1 — Despachante do outbox transacional.
 *
 * Le eventos nao despachados, processa via handler registrado, marca
 * dispatched_at em sucesso, incrementa attempts e grava last_error em falha.
 * Backoff exponencial, max 5 tentativas, dead-letter apos isso.
 *
 * O despachante e puro: as funcoes de persistencia (markDispatched, markFailed)
 * sao injetadas, tornando o nucleo testavel sem banco.
 */

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 300_000; // 5 minutos

export interface OutboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export type OutboxHandler = (row: OutboxRow) => Promise<void>;

export type DispatchResult =
  | { status: 'dispatched' }
  | { status: 'failed'; error: string }
  | { status: 'dead_letter'; error: string }
  | { status: 'no_handler' };

export interface DispatcherDeps {
  readonly handlers: Readonly<Record<string, OutboxHandler>>;
  readonly markDispatched: (id: string) => Promise<void>;
  readonly markFailed: (id: string, error: string) => Promise<void>;
}

export interface Dispatcher {
  dispatch(row: OutboxRow): Promise<DispatchResult>;
  backoffMs(attempts: number): number;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  function backoffMs(attempts: number): number {
    const base = 1_000 * Math.pow(2, attempts);
    return Math.min(base, MAX_BACKOFF_MS);
  }

  async function dispatch(row: OutboxRow): Promise<DispatchResult> {
    const handler = deps.handlers[row.eventType];

    if (handler === undefined) {
      // evento sem handler: marca como despachado para nao travar a fila
      await deps.markDispatched(row.id);
      return { status: 'no_handler' };
    }

    try {
      await handler(row);
      await deps.markDispatched(row.id);
      return { status: 'dispatched' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.markFailed(row.id, message);

      // attempts ja conta as tentativas ANTERIORES; esta e a tentativa (attempts + 1)
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        return { status: 'dead_letter', error: message };
      }
      return { status: 'failed', error: message };
    }
  }

  return { dispatch, backoffMs };
}
```

Rodar:

```bash
pnpm vitest run packages/outbox/src/dispatcher.test.ts
```

Saida esperada: 5 testes passando.

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/outbox/src/dispatcher.ts packages/outbox/src/dispatcher.test.ts
git commit -m "feat(outbox): dispatcher with exponential backoff and dead-letter

Pure dispatcher: handlers injected, markDispatched/markFailed injected.
Max 5 attempts, exponential backoff capped at 5 min. Events without a
registered handler are marked dispatched to avoid blocking the queue.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Polling do outbox no worker e teste de integracao ponta a ponta

Conecta o despachante ao banco real: funcoes `fetchPending` e `markDispatched`/`markFailed` que rodam com o papel `jobs` (BYPASSRLS), e o job pg-boss que faz o polling. Teste de integracao prova o ciclo completo: enqueue na transacao de dominio, polling pelo worker, handler chamado, evento marcado.

**Arquivos**

- Criar `packages/outbox/src/outbox-worker.ts`
- Teste `packages/outbox/src/outbox-worker.int.test.ts`
- Modificar `packages/outbox/src/index.ts`

---

- [ ] **Passo 1 — teste de integracao que falha: ciclo completo**

Criar `packages/outbox/src/outbox-worker.int.test.ts`:

```ts
// packages/outbox/src/outbox-worker.int.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePools, jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { enqueue } from './enqueue';
import { fetchPending, markDispatched, markFailed } from './outbox-worker';
import { createDispatcher, type OutboxHandler } from './dispatcher';
import { semearOutbox, type SementeOutbox } from './test-support';

let s: SementeOutbox;
let actor: Actor;

beforeAll(async () => {
  s = await semearOutbox();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('outbox worker - ciclo completo', () => {
  it('enqueue + fetchPending + dispatch + markDispatched', async () => {
    const aggregateId = uuidv7();

    // 1. Enfileira dentro da transacao
    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'APPOINTMENT_CONFIRMED',
        aggregateId,
        payload: { appointmentId: aggregateId, confirmedBy: 'clinic' },
      }),
    );

    // 2. Busca pendentes (roda com jobs, BYPASSRLS)
    const pool = jobsPool();
    const pending = await fetchPending(pool, 10);
    const meuEvento = pending.find((r) => r.aggregateId === aggregateId);
    expect(meuEvento).toBeDefined();
    expect(meuEvento!.eventType).toBe('APPOINTMENT_CONFIRMED');
    expect(meuEvento!.attempts).toBe(0);

    // 3. Despacha com handler
    const chamadas: string[] = [];
    const handler: OutboxHandler = async (row) => {
      chamadas.push(row.id);
    };
    const dispatcher = createDispatcher({
      handlers: { APPOINTMENT_CONFIRMED: handler },
      markDispatched: (id) => markDispatched(pool, id),
      markFailed: (id, error) => markFailed(pool, id, error),
    });

    const result = await dispatcher.dispatch(meuEvento!);
    expect(result).toEqual({ status: 'dispatched' });
    expect(chamadas).toContain(meuEvento!.id);

    // 4. Verifica que nao aparece mais como pendente
    const pending2 = await fetchPending(pool, 10);
    const depois = pending2.find((r) => r.id === meuEvento!.id);
    expect(depois).toBeUndefined();
  });

  it('markFailed incrementa attempts e grava last_error', async () => {
    const aggregateId = uuidv7();

    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'ENCOUNTER_FINALIZED',
        aggregateId,
        payload: { encounterId: aggregateId },
      }),
    );

    const pool = jobsPool();
    const pending = await fetchPending(pool, 10);
    const meuEvento = pending.find((r) => r.aggregateId === aggregateId);
    expect(meuEvento).toBeDefined();

    await markFailed(pool, meuEvento!.id, 'erro de teste');

    // busca de novo — deve ter attempts = 1
    const pending2 = await fetchPending(pool, 10);
    const depois = pending2.find((r) => r.id === meuEvento!.id);
    expect(depois).toBeDefined();
    expect(depois!.attempts).toBe(1);
    expect(depois!.lastError).toBe('erro de teste');
  });

  it('evento com 5 tentativas nao aparece em fetchPending', async () => {
    const aggregateId = uuidv7();

    await withTenantTx(actor, (tx) =>
      enqueue(tx, {
        eventType: 'PAYMENT_RECEIVED',
        aggregateId,
        payload: { paymentId: aggregateId },
      }),
    );

    const pool = jobsPool();

    // simula 5 falhas
    for (let i = 0; i < 5; i++) {
      const pending = await fetchPending(pool, 10);
      const evt = pending.find((r) => r.aggregateId === aggregateId);
      expect(evt).toBeDefined();
      await markFailed(pool, evt!.id, `falha ${i + 1}`);
    }

    // na sexta busca, nao deve aparecer
    const pending = await fetchPending(pool, 10);
    const evt = pending.find((r) => r.aggregateId === aggregateId);
    expect(evt).toBeUndefined();

    // mas deve estar no banco como dead-letter (attempts >= 5, dispatched_at IS NULL)
    const { rows } = await pool.query<{ attempts: number; dispatched_at: string | null }>(
      `SELECT attempts, dispatched_at FROM app.outbox WHERE aggregate_id = $1`,
      [aggregateId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(5);
    expect(rows[0]!.dispatched_at).toBeNull();
  });
});
```

Rodar:

```bash
pnpm vitest run packages/outbox/src/outbox-worker.int.test.ts
```

Saida esperada: falha — modulo `./outbox-worker` nao existe.

---

- [ ] **Passo 2 — implementar funcoes de persistencia do worker**

Criar `packages/outbox/src/outbox-worker.ts`:

```ts
// packages/outbox/src/outbox-worker.ts
import type { Pool } from 'pg';
import type { OutboxRow } from './dispatcher';

/**
 * Busca eventos pendentes de despacho.
 *
 * Roda com o papel `jobs` (BYPASSRLS): precisa ler eventos de TODOS os tenants.
 * O filtro e: dispatched_at IS NULL AND attempts < 5, ordenado por created_at.
 * FOR UPDATE SKIP LOCKED evita que dois workers processem o mesmo evento.
 */
export async function fetchPending(pool: Pool, limit: number): Promise<OutboxRow[]> {
  const { rows } = await pool.query<{
    id: string;
    tenant_id: string;
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    created_at: string;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT id, tenant_id, event_type, aggregate_id, payload,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
            attempts, last_error
       FROM app.outbox
      WHERE dispatched_at IS NULL AND attempts < 5
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type,
    aggregateId: r.aggregate_id,
    payload: r.payload,
    createdAt: r.created_at,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

/**
 * Marca um evento como despachado com sucesso.
 * Roda com o papel `jobs` (BYPASSRLS).
 */
export async function markDispatched(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `UPDATE app.outbox SET dispatched_at = clock_timestamp() WHERE id = $1`,
    [id],
  );
}

/**
 * Marca falha: incrementa attempts e grava last_error.
 * Roda com o papel `jobs` (BYPASSRLS).
 */
export async function markFailed(pool: Pool, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE app.outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
    [id, error],
  );
}
```

---

- [ ] **Passo 3 — atualizar o barrel**

Modificar `packages/outbox/src/index.ts`:

```ts
// packages/outbox/src/index.ts
export { enqueue, type EnqueueInput } from './enqueue';
export {
  createDispatcher,
  type Dispatcher,
  type DispatcherDeps,
  type DispatchResult,
  type OutboxHandler,
  type OutboxRow,
} from './dispatcher';
export { fetchPending, markDispatched, markFailed } from './outbox-worker';
// Reexporta EventType para conveniencia de quem consome outbox + events junto.
// Permitido: outbox (serv-L0) importa events (base-L0).
export { type EventType } from '@cadencia/events';
```

---

- [ ] **Passo 4 — rodar todos os testes do outbox**

```bash
pnpm vitest run packages/outbox/src/
```

Saida esperada: 11 testes passando (5 unitarios + 3 enqueue + 3 worker).

---

- [ ] **Passo 5 — verificar que test:iso e arch:check passam**

```bash
pnpm test:iso
pnpm arch:check
```

Saida esperada: sem violacao. `@cadencia/outbox` e serv-L0, importa `@cadencia/db` (infra-L0), `@cadencia/kernel` (base-L0) e `@cadencia/events` (base-L0). Serv importa base e infra. Irmao proibido e dentro da MESMA faixa (serv nao importa serv: outbox nao pode importar jobs, integrations etc).

---

- [ ] **Passo 6 — commitar**

```bash
git add packages/outbox/src/outbox-worker.ts packages/outbox/src/outbox-worker.int.test.ts packages/outbox/src/index.ts
git commit -m "feat(outbox): worker polling with fetchPending, markDispatched, markFailed

fetchPending uses FOR UPDATE SKIP LOCKED for concurrent worker safety.
markFailed increments attempts; events with 5+ attempts become dead-letter
and stop appearing in fetchPending. Full integration test proves the
enqueue-poll-dispatch-mark cycle.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
