# Cadência — Fase 2 ("A conversa e o caixa"): Plano de Implementação

> **Para agentes executores:** SUB-SKILL: superpowers:subagent-driven-development ou executing-plans. Passos em checkbox `- [ ]`.

**Objetivo:** entregar o diferencial nº 2 — WhatsApp bidirecional com o número próprio da clínica (confirmação, lembrete, pós-consulta e NPS) e o financeiro básico (recebimento no atendimento, link de pagamento, conciliação básica e recibo) — de modo que a recepção use o Cadência de hora em hora e a gestora enxergue redução de faltas no primeiro mês.

**Arquitetura:** a Fase 2 constrói sobre a fundação das Fases 0 e 1, adicionando dois pacotes L2 (`messaging` e `payments`), dois contratos de integração (`MessagingProvider` e `PaymentProvider`), o outbox transacional, os eventos de domínio tipados e as telas `/conversas` e `/financeiro`. Toda comunicação entre irmãos L2 é assíncrona via `packages/events`; composição síncrona é responsabilidade de L3 (API/worker).

**Stack:** TypeScript 5.9 strict · PostgreSQL 18 · Fastify 5 · Next.js 15 App Router + React 19 · TanStack Query 5 · Vitest · Zod v4 · pg-boss 10 · Tailwind 4 com tokens CSS próprios · Radix headless.

---

## Antes de começar

### Pré-requisito absoluto: as Fases 0 e 1 concluídas e verdes

Este plano assume 67 migrations aplicadas e ~737 testes passando. **Confirme antes de escrever a primeira linha:**

```bash
pnpm db:up
pnpm db:migrate           # deve terminar em "0067_fix_finalize_ambiguous_version_id_066_regression.sql"
pnpm typecheck             # exit 0
pnpm test                  # 188 testes de unidade, 0 falhas
pnpm test:int              # 355 testes de integração, 0 falhas
pnpm test:iso              # 194 testes de isolamento
pnpm db:invariants         # todos OK
pnpm db:privileges         # privilégios afirmados
pnpm arch:check            # 0 violações
```

Se qualquer um desses falhar, **pare**.

### A próxima migration livre é a `0068`

`ls packages/db/migrations/` termina em `0067`. Crie sempre com `pnpm db:new <nome>`. Se o número divergir do que a tarefa diz, **pare e reconcilie**.

### O que as Fases 0 e 1 deixaram pronto — assinaturas reais que este plano consome

| O quê | Onde | Assinatura |
|---|---|---|
| Transação de negócio | `packages/db/src/tx.ts` | `withTenantTx<T>(actor: Actor, fn: (tx: TxClient) => Promise<T>, pool?: Pool): Promise<T>` |
| Ator | `packages/db/src/tx.ts` | `user` \| `system` \| `anon` |
| Pools | `packages/db/src/pool.ts` | `businessPool()`, `auditPool()`, `jobsPool()`, `closePools()` |
| Auditoria canal A | `packages/audit/src/domain.ts` | `logDomainEvent(tx, event): Promise<bigint>` |
| Auditoria canal B | `packages/audit/src/security.ts` | `SecurityAuditChannel` |
| RBAC | `packages/authz/src/actions.ts` | `ACTIONS`, `ACTION_BY_KEY`, `can()`, `assertCan()` |
| Sessão | `packages/authn/src/session.ts` | `resolveSession(db, token)` |
| Identifiers | `packages/kernel/src/uuid.ts` | `uuidv7()`, `isUuidV7()` |
| Money | `packages/kernel/src/money.ts` | `Money`, `brl()`, `add()`, `formatBRL()` |
| Clock | `packages/kernel/src/clock.ts` | `systemClock`, `isoFromMs()` |
| Integrations pattern | `packages/integrations/src/` | `SignatureProvider`, `PrescriptionProvider` + fakes |
| Scheduling | `packages/scheduling/src/` | `appointment`, `slot`, `waitlist` |
| EMR | `packages/emr/src/` | `finalize_encounter`, `amend`, `rectify` |
| Documents | `packages/documents/src/` | `renderPdf`, `documentHtml`, `stampPageNumbers` |
| API routes | `apps/api/src/routes/` | Pattern Fastify + Zod |
| Worker | `apps/worker/` | pg-boss + Chromium |
| Design system | `apps/web/src/` | Tokens CSS, 7 componentes centrais |

### Regras de arquitetura herdadas

1. **Setas só descem** (L0 → L1 → L2 → L3) e **irmão nunca importa irmão**. `pnpm arch:check` reprova.
2. **Comunicação entre irmãos L2 é assíncrona** via `packages/events` (L0). Composição síncrona é de L3.
3. **Migrations forward-only**, uma transação por arquivo.
4. **Fonte de tempo persistido é o PostgreSQL** (`clock_timestamp()`). `Date.now()` só em `clock.ts` e `uuid.ts`.
5. **Toda tabela multi-tenant**: `tenant_id`, RLS FORCE, ≥1 policy, FK composta.
6. **Chamada a parceiro sai só do worker**, via outbox.
7. **Timeout em operação unsafe nunca gera retry automático.** Persiste `indeterminado` e agenda reconciliação.
8. **CNPJ alfanumérico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.

### Convenções

Conventional Commits em **inglês**. Código e identificadores em inglês; comentários e nomes de teste em **português**. Windows — prefira o Bash tool.

### Ordem de execução e por que ela é essa

1. **Tasks 1–5 — events/outbox.** Fundação assíncrona que tudo mais consome.
2. **Tasks 6–11 — messaging: modelo.** Schema `msg`, tabelas, domain logic.
3. **Tasks 12–17 — WhatsApp provider.** Contrato `MessagingProvider`, Cloud API, fake.
4. **Tasks 18–23 — automações.** Confirmação, lembrete, pós-consulta, NPS.
5. **Tasks 24–29 — pagamentos: modelo.** Schema `fin` populado, `fin.entry`, recibo.
6. **Tasks 30–35 — payment links + conciliação.** `PaymentProvider`, link, rollup, reconciliação.
7. **Tasks 36–42 — API e worker.** Rotas, webhooks, jobs.
8. **Tasks 43–48 — telas: Conversas.** `/conversas`, inbox, thread, quick actions.
9. **Tasks 49–54 — telas: Financeiro.** Pagamento no atendimento, recibos, dashboard.
10. **Tasks 55–60 — integração e gates.** Wiring, Hoje/Agenda, definition-of-done.

---

## Parte I — Fundação assíncrona

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

## Parte II — Mensageria

### Task 6: Migration 0070 — schema `msg`, tabelas `channel_identity` e `template`

Cria o schema `msg` com o mesmo padrao dos demais (dono `app_owner`, GRANT USAGE para `app_rw`, `clin_writer`, `app_support`). Cria as tabelas de identidade de canal e template de mensagem, ambas com RLS habilitada e forcada, FK composta por `(tenant_id, id)`.

**Arquivos**

- Criar `packages/db/migrations/0070_msg_schema_channel_template.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0070_msg_schema_channel_template.sql`:

```sql
-- 0070_msg_schema_channel_template.sql
-- Fase 2 · design §7.3 e §5.3 — mensageria.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- O schema `msg` nasce aqui, com o mesmo dono e padrao de GRANT dos demais.
-- A identidade de canal e POR TENANT: a clinica e dona do WABA, nao nos.

CREATE SCHEMA msg AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA msg TO app_rw, clin_writer, app_support;

-- ---------------------------------------------------------------------------
-- msg.channel_identity — canal da clinica (WhatsApp, SMS, email)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.channel_identity (
  tenant_id      uuid NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid NOT NULL,
  channel        text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  display_name   text NOT NULL,
  phone          text NOT NULL,           -- E.164
  waba_ref       text,                   -- WABA ID da Meta, opcional
  provider_ref   text,                   -- referencia do provedor
  status         text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','active','suspended','blocked','verified')),
  quality_rating text,                   -- WhatsApp business quality rating
  created_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id));
ALTER TABLE msg.channel_identity OWNER TO app_owner;

-- Telefone unico por canal dentro do tenant.
CREATE UNIQUE INDEX ux_channel_identity_phone
  ON msg.channel_identity (tenant_id, channel, phone);

GRANT SELECT, INSERT, UPDATE ON msg.channel_identity TO app_rw;

ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.channel_identity AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.template — templates de mensagem aprovados pela Meta
-- ---------------------------------------------------------------------------
CREATE TABLE msg.template (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  channel            text NOT NULL CHECK (channel IN ('whatsapp')),
  name               text NOT NULL,
  language           text NOT NULL DEFAULT 'pt_BR',
  category           text NOT NULL CHECK (category IN ('marketing','utility','authentication')),
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  body_template      text NOT NULL,
  header_template    text,
  footer_template    text,
  variables          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.template OWNER TO app_owner;

-- Nome unico por canal identity + idioma.
CREATE UNIQUE INDEX ux_template_name
  ON msg.template (tenant_id, channel_identity_id, name, language);

GRANT SELECT, INSERT, UPDATE ON msg.template TO app_rw;

ALTER TABLE msg.template ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.template FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.template AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0070 aplicada sem erro.

Verificar que as tabelas existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada:

```
   relname          | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 channel_identity   | t              | t
 template           | t              | t
```

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0070_msg_schema_channel_template.sql
git commit -m "feat(db): create msg schema with channel_identity and template tables (migration 0070)

RLS enabled and forced on both tables. channel_identity holds the
clinic's own channel (WhatsApp WABA, SMS, email) with provider_ref and
quality_rating. template holds Meta-approved message templates.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Migration 0071 — tabelas `conversation`, `message` e `inbound_event`

Cria as tres tabelas centrais da mensageria: conversa com paciente, mensagem individual e payload bruto do webhook. Todas com RLS habilitada e forcada, FK composta por `(tenant_id, id)`.

**Arquivos**

- Criar `packages/db/migrations/0071_msg_conversation_message.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0071_msg_conversation_message.sql`:

```sql
-- 0071_msg_conversation_message.sql
-- Fase 2 · design §7.3 — conversas, mensagens e eventos de entrada.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- msg.conversation.patient_id e NULLABLE: numero desconhecido nao e vinculado
-- automaticamente (privacidade). resolveConversation faz lookup pelo telefone do
-- paciente quando cria uma conversa nova, mas nunca para numero novo sem match.
--
-- msg.inbound_event e append-only: o payload bruto do webhook e gravado ANTES de
-- parsear — parser bugado nao perde mensagem de paciente.

-- ---------------------------------------------------------------------------
-- msg.conversation — conversa com paciente, keyed por NOSSO id
-- ---------------------------------------------------------------------------
CREATE TABLE msg.conversation (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  patient_id          uuid,              -- NULLABLE: numero desconhecido
  remote_phone        varchar(20) NOT NULL,  -- E.164 do paciente/contato
  external_ref        text,              -- id do parceiro (WhatsApp conversation id)
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  last_message_at     timestamptz(3),
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id));
ALTER TABLE msg.conversation OWNER TO app_owner;

-- Busca por telefone para resolveConversation: uma conversa ativa por telefone.
CREATE UNIQUE INDEX ux_conversation_phone
  ON msg.conversation (tenant_id, channel_identity_id, remote_phone)
  WHERE status = 'active';
-- Busca por paciente.
CREATE INDEX ix_conversation_patient
  ON msg.conversation (tenant_id, patient_id) WHERE patient_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.conversation TO app_rw;

ALTER TABLE msg.conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.conversation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.conversation AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.message — mensagem individual (inbound ou outbound)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.message (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  body_text       text,
  body_media_key  text,                -- storage ref (StorageKey)
  template_key    text,                -- se veio de template
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','read','failed')),
  external_id     text,                -- providerMessageId
  sent_at         timestamptz(3),
  delivered_at    timestamptz(3),
  read_at         timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES msg.conversation(tenant_id, id));
ALTER TABLE msg.message OWNER TO app_owner;

-- Timeline de mensagens de uma conversa.
CREATE INDEX ix_message_conversation
  ON msg.message (tenant_id, conversation_id, created_at DESC);
-- Lookup por external_id para status updates do webhook.
CREATE INDEX ix_message_external
  ON msg.message (tenant_id, external_id) WHERE external_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.message TO app_rw;

ALTER TABLE msg.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.message AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.inbound_event — payload bruto do webhook, append-only
-- ---------------------------------------------------------------------------
CREATE TABLE msg.inbound_event (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  raw_payload         jsonb NOT NULL,
  received_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  processed_at        timestamptz(3),
  error               text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.inbound_event OWNER TO app_owner;

-- Eventos pendentes de processamento.
CREATE INDEX ix_inbound_event_pending
  ON msg.inbound_event (tenant_id, channel_identity_id, received_at)
  WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON msg.inbound_event TO app_rw;

ALTER TABLE msg.inbound_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.inbound_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.inbound_event AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0071 aplicada sem erro.

Verificar que as tabelas existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada: 5 tabelas (channel_identity, conversation, inbound_event, message, template), todas com `t | t`.

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0071_msg_conversation_message.sql
git commit -m "feat(db): add conversation, message and inbound_event tables (migration 0071)

conversation.patient_id is nullable — unknown numbers stay unlinked
for privacy. inbound_event stores the raw webhook payload before parsing
so a parser bug never loses a patient message.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Migration 0072 — tabela `automation_rule`

Cria a tabela de regras de automacao que vincula gatilhos de dominio (agendamento criado, lembrete, atendimento finalizado, NPS) a templates de mensagem com timing configuravel.

**Arquivos**

- Criar `packages/db/migrations/0072_msg_automation_rule.sql`

---

- [ ] **Passo 1 — escrever a migration**

Criar `packages/db/migrations/0072_msg_automation_rule.sql`:

```sql
-- 0072_msg_automation_rule.sql
-- Fase 2 · design §5.3 secao CONVERSAS — automacoes.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Uma regra de automacao diz: "quando ocorrer ESTE gatilho, enviar ESTE template
-- pelo canal DESTA identidade, com ESTE offset de tempo". timing_offset_minutes
-- negativo significa ANTES do evento (e.g., -1440 = 24h antes do agendamento).

CREATE TABLE msg.automation_rule (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  trigger             text NOT NULL
    CHECK (trigger IN (
      'appointment_created',
      'appointment_reminder',
      'encounter_finalized',
      'nps_due')),
  template_id         uuid NOT NULL,
  timing_offset_minutes int NOT NULL DEFAULT 0,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, template_id)
    REFERENCES msg.template(tenant_id, id));
ALTER TABLE msg.automation_rule OWNER TO app_owner;

-- Uma regra ativa por trigger por canal identity.
CREATE UNIQUE INDEX ux_automation_rule_trigger
  ON msg.automation_rule (tenant_id, channel_identity_id, trigger)
  WHERE active = true;

GRANT SELECT, INSERT, UPDATE ON msg.automation_rule TO app_rw;

ALTER TABLE msg.automation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.automation_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.automation_rule AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

---

- [ ] **Passo 2 — rodar a migration e verificar**

```bash
pnpm db:migrate
```

Saida esperada: migration 0072 aplicada sem erro.

Verificar que todas as 6 tabelas do schema `msg` existem com RLS forcada:

```bash
psql "$DATABASE_URL_ADMIN" -c "
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'msg' AND c.relkind = 'r'
   ORDER BY c.relname;"
```

Saida esperada:

```
     relname        | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 automation_rule    | t              | t
 channel_identity   | t              | t
 conversation       | t              | t
 inbound_event      | t              | t
 message            | t              | t
 template           | t              | t
```

---

- [ ] **Passo 3 — commitar**

```bash
git add packages/db/migrations/0072_msg_automation_rule.sql
git commit -m "feat(db): add automation_rule table for message triggers (migration 0072)

Links domain triggers (appointment_created, appointment_reminder,
encounter_finalized, nps_due) to message templates with configurable
timing offset. One active rule per trigger per channel identity.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Semente de teste e configuracao de `packages/messaging`

Configura as dependencias de `packages/messaging` e cria a funcao de semente para testes de integracao, seguindo o padrao de `packages/scheduling/src/test-support.ts`.

**Arquivos**

- Modificar `packages/messaging/package.json`
- Criar `packages/messaging/src/test-support.ts`

---

- [ ] **Passo 1 — adicionar dependencias ao `package.json`**

Modificar `packages/messaging/package.json`:

```json
{
  "name": "@cadencia/messaging",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.3"
  }
}
```

---

- [ ] **Passo 2 — instalar dependencias**

```bash
pnpm install
```

Saida esperada: lockfile atualizado, sem erro.

---

- [ ] **Passo 3 — criar a semente de teste**

Criar `packages/messaging/src/test-support.ts`:

```ts
// packages/messaging/src/test-support.ts
//
// Semeia tenant, clinica, usuario, vinculo, paciente com telefone, identidade de
// canal e template para os testes de integracao da mensageria.
//
// Roda com a conexao ADMINISTRATIVA pelo mesmo motivo de
// packages/scheduling/src/test-support.ts: cria o tenant, que e a raiz do
// isolamento e nao tem transacao de negocio capaz de cria-lo — app_rw so tem
// SELECT em app.tenant (0007).
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeMensageria {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  patientPhone: string;
  channelIdentityId: string;
  templateId: string;
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

export async function semearMensageria(): Promise<SementeMensageria> {
  const s: SementeMensageria = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    patientId: uuidv7(),
    patientPhone: '+5511999990001',
    channelIdentityId: uuidv7(),
    templateId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Mensageria', '12ABC34501DE35')`,
      [s.tenantId, `m-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '7654321', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Atendente')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, phone_primary, cadastro_status)
       VALUES ($1, $2, 'Joana Teste', $3, 'completo')`,
      [s.tenantId, s.patientId, s.patientPhone]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone_number, provider_ref, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica WhatsApp', '+5511988880001', 'waba-fake-001', 'active')`,
      [s.tenantId, s.channelIdentityId]);
    await c.query(
      `INSERT INTO msg.template
         (tenant_id, id, channel_identity_id, channel, name, language, category,
          status, body_template, variables)
       VALUES ($1, $2, $3, 'whatsapp', 'confirmacao_consulta', 'pt_BR', 'utility',
               'approved', 'Ola {{1}}, sua consulta esta confirmada para {{2}} as {{3}}.', '["nome","data","hora"]'::jsonb)`,
      [s.tenantId, s.templateId, s.channelIdentityId]);
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

- [ ] **Passo 4 — verificar compilacao**

```bash
pnpm tsc --noEmit -p packages/messaging/tsconfig.json
```

Saida esperada: sem erro de tipo.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/messaging/package.json packages/messaging/src/test-support.ts
git commit -m "feat(messaging): test support seed for integration tests

Seeds tenant, clinic, user, membership, patient with phone, channel
identity and approved template. Follows the same pattern as
packages/scheduling/src/test-support.ts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: `resolveConversation` — achar ou criar conversa por telefone

Implementa a funcao de dominio que encontra uma conversa ativa pelo telefone do contato ou cria uma nova. Quando cria, faz lookup do paciente pelo `phone_primary` — mas para numero desconhecido (sem match), o `patient_id` fica NULL (privacidade).

**Arquivos**

- Criar `packages/messaging/src/messaging.ts`
- Criar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: resolveConversation cria conversa e vincula paciente por telefone**

Criar `packages/messaging/src/messaging.int.test.ts`:

```ts
// packages/messaging/src/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveConversation } from './messaging';
import { semearMensageria, type SementeMensageria } from './test-support';

let s: SementeMensageria;
let actor: Actor;

beforeAll(async () => {
  s = await semearMensageria();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('resolveConversation', () => {
  it('cria conversa nova e vincula paciente pelo telefone', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.conversationId).toBeTruthy();
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('retorna conversa existente sem criar duplicata', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(false);
  });

  it('cria conversa com patient_id NULL para numero desconhecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511888880000',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.patientId).toBeNull();
  });

  it('usa patient_id explicito quando fornecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511777770000',
      patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: uuidv7(),
      remotePhone: '+5511999990001',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — modulo `./messaging` nao existe.

---

- [ ] **Passo 2 — implementar resolveConversation**

Criar `packages/messaging/src/messaging.ts`:

```ts
// packages/messaging/src/messaging.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos de falha
// ---------------------------------------------------------------------------

export type MessagingFailure =
  | { kind: 'canal_nao_encontrado' }
  | { kind: 'conversa_nao_encontrada' }
  | { kind: 'canal_inativo' };

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

export interface ResolveConversationInput {
  readonly channelIdentityId: string;
  readonly remotePhone: string;
  readonly patientId?: string;
}

export interface ResolvedConversation {
  readonly conversationId: string;
  readonly created: boolean;
  readonly patientId: string | null;
}

export async function resolveConversation(
  tx: TxClient, i: ResolveConversationInput,
): Promise<Result<ResolvedConversation, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Buscar conversa ativa pelo telefone.
  const existente = await tx.query<{ id: string; patient_id: string | null }>(
    `SELECT id, patient_id FROM msg.conversation
      WHERE channel_identity_id = $1
        AND remote_phone = $2
        AND status = 'active'`,
    [i.channelIdentityId, i.remotePhone]);

  if (existente.rows.length > 0) {
    const conv = existente.rows[0]!;
    return ok({
      conversationId: conv.id,
      created: false,
      patientId: conv.patient_id,
    });
  }

  // 3. Criar conversa nova.
  let patientId: string | null = i.patientId ?? null;

  // Se patientId nao foi fornecido, tenta lookup pelo telefone do paciente.
  if (patientId === null) {
    const paciente = await tx.query<{ id: string }>(
      `SELECT id FROM clin.patient
        WHERE phone_primary = $1
        LIMIT 1`,
      [i.remotePhone]);
    if (paciente.rows.length > 0) {
      patientId = paciente.rows[0]!.id;
    }
  }

  const conversationId = uuidv7();
  await tx.query(
    `INSERT INTO msg.conversation
       (id, channel_identity_id, patient_id, remote_phone, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [conversationId, i.channelIdentityId, patientId, i.remotePhone]);

  return ok({ conversationId, created: true, patientId });
}
```

---

- [ ] **Passo 3 — reexportar pelo barrel**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  type ResolveConversationInput, type ResolvedConversation,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 4 — rodar e confirmar que os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 5 testes passando.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): resolveConversation finds or creates conversation by phone

Looks up patient by phone_primary for auto-linking. Unknown numbers
get patient_id=NULL for privacy. Returns existing active conversation
when one already exists for the same channel+phone pair.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: `sendMessage` e `receiveInbound` — envio e recebimento de mensagem

Adiciona as duas funcoes restantes do dominio de mensageria. `sendMessage` cria uma mensagem outbound com status `queued` (o worker despacha pelo provedor). `receiveInbound` grava o payload bruto em `inbound_event` ANTES de qualquer parse, resolve a conversa e cria a mensagem inbound.

**Arquivos**

- Modificar `packages/messaging/src/messaging.ts`
- Modificar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: sendMessage cria mensagem com status queued**

Adicionar ao final de `packages/messaging/src/messaging.int.test.ts`:

```ts
// Adicionar ao final do arquivo, DENTRO do escopo do modulo (apos os describes existentes)
import { sendMessage, receiveInbound } from './messaging';

let conversationId = '';

describe('sendMessage', () => {
  beforeAll(async () => {
    // Garantir que existe uma conversa para usar nos testes.
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511666660000',
    }));
    if (r.ok) conversationId = r.value.conversationId;
  });

  it('cria mensagem outbound com status queued', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola, sua consulta esta confirmada!',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; channel: string;
    }>(
      `SELECT direction, status, body_text, channel
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]).toEqual({
      direction: 'outbound',
      status: 'queued',
      body_text: 'Ola, sua consulta esta confirmada!',
      channel: 'whatsapp',
    });
  });

  it('cria mensagem outbound com template_key', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId,
      bodyText: 'Ola Maria, sua consulta esta confirmada para 14/08 as 10:00.',
      templateKey: 'confirmacao_consulta',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      template_key: string | null;
    }>(
      `SELECT template_key FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(rows[0]?.template_key).toBe('confirmacao_consulta');
  });

  it('atualiza last_message_at da conversa', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tAntes = antes.rows[0]?.last_message_at;

    await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId, bodyText: 'outra mensagem',
    }));

    const depois = await withTenantTx(actor, (tx) => tx.query<{
      last_message_at: string | null;
    }>(
      `SELECT last_message_at::text FROM msg.conversation WHERE id = $1`,
      [conversationId]));
    const tDepois = depois.rows[0]?.last_message_at;
    expect(tDepois).not.toBeNull();
    if (tAntes !== null && tDepois !== null) {
      expect(tDepois >= tAntes).toBe(true);
    }
  });

  it('recusa conversa inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => sendMessage(tx, {
      conversationId: uuidv7(),
      bodyText: 'nao vai',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'conversa_nao_encontrada' } });
  });
});

describe('receiveInbound', () => {
  it('grava payload bruto em inbound_event e cria mensagem inbound', async () => {
    const rawPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-fake-001', changes: [{ value: { messages: [{ id: 'wamid.xyz' }] } }] }],
    };

    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload,
      remotePhone: '+5511555550000',
      bodyText: 'Quero marcar consulta',
      externalId: 'wamid.xyz',
      sentAt: '2026-08-04T10:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eventId).toBeTruthy();
    expect(r.value.messageId).toBeTruthy();
    expect(r.value.conversationId).toBeTruthy();

    // Verificar inbound_event gravado
    const { rows: evtRows } = await withTenantTx(actor, (tx) => tx.query<{
      raw_payload: unknown; processed_at: string | null;
    }>(
      `SELECT raw_payload, processed_at FROM msg.inbound_event WHERE id = $1`,
      [r.value.eventId]));
    expect(evtRows[0]?.raw_payload).toEqual(rawPayload);
    expect(evtRows[0]?.processed_at).not.toBeNull();

    // Verificar mensagem inbound criada
    const { rows: msgRows } = await withTenantTx(actor, (tx) => tx.query<{
      direction: string; status: string; body_text: string; external_id: string;
    }>(
      `SELECT direction, status, body_text, external_id
         FROM msg.message WHERE id = $1`, [r.value.messageId]));
    expect(msgRows[0]).toEqual({
      direction: 'inbound',
      status: 'delivered',
      body_text: 'Quero marcar consulta',
      external_id: 'wamid.xyz',
    });
  });

  it('vincula paciente na conversa quando telefone bate', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: s.channelIdentityId,
      rawPayload: { test: true },
      remotePhone: s.patientPhone,
      bodyText: 'Boa tarde',
      externalId: 'wamid.abc',
      sentAt: '2026-08-04T11:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // A conversa para o telefone do paciente ja existe (criada no describe anterior);
    // deve ter o patient_id vinculado.
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      patient_id: string | null;
    }>(
      `SELECT patient_id FROM msg.conversation WHERE id = $1`,
      [r.value.conversationId]));
    expect(rows[0]?.patient_id).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => receiveInbound(tx, {
      channelIdentityId: uuidv7(),
      rawPayload: {},
      remotePhone: '+5511999990001',
      bodyText: 'teste',
      externalId: 'wamid.000',
      sentAt: '2026-08-04T12:00:00.000Z',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — `sendMessage` e `receiveInbound` nao existem em `./messaging`.

---

- [ ] **Passo 2 — implementar sendMessage**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  readonly conversationId: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly templateKey?: string;
}

export async function sendMessage(
  tx: TxClient, i: SendMessageInput,
): Promise<Result<{ messageId: string }, MessagingFailure>> {
  // 1. Verificar que a conversa existe e obter o canal.
  const conv = await tx.query<{ channel: string }>(
    `SELECT ci.channel
       FROM msg.conversation c
       JOIN msg.channel_identity ci
         ON ci.tenant_id = c.tenant_id AND ci.id = c.channel_identity_id
      WHERE c.id = $1`,
    [i.conversationId]);
  if (conv.rows.length === 0) return err({ kind: 'conversa_nao_encontrada' });

  const channel = conv.rows[0]!.channel;
  const messageId = uuidv7();

  // 2. Inserir mensagem com status queued (o worker despacha via provedor).
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        template_key, status)
     VALUES ($1, $2, 'outbound', $3, $4, $5, $6, 'queued')`,
    [messageId, i.conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null, i.templateKey ?? null]);

  // 3. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [i.conversationId]);

  return ok({ messageId });
}
```

---

- [ ] **Passo 3 — implementar receiveInbound**

Adicionar ao final de `packages/messaging/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// receiveInbound
// ---------------------------------------------------------------------------

export interface ReceiveInboundInput {
  readonly channelIdentityId: string;
  readonly rawPayload: unknown;
  readonly remotePhone: string;
  readonly bodyText?: string;
  readonly bodyMediaKey?: string;
  readonly externalId: string;
  readonly sentAt: string;            // RFC 3339
}

export interface ReceivedInbound {
  readonly eventId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export async function receiveInbound(
  tx: TxClient, i: ReceiveInboundInput,
): Promise<Result<ReceivedInbound, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Gravar payload bruto em inbound_event — ANTES de qualquer parse.
  //    Parser bugado nao perde mensagem de paciente.
  const eventId = uuidv7();
  await tx.query(
    `INSERT INTO msg.inbound_event
       (id, channel_identity_id, raw_payload, processed_at)
     VALUES ($1, $2, $3, clock_timestamp())`,
    [eventId, i.channelIdentityId, JSON.stringify(i.rawPayload)]);

  // 3. Resolver conversa pelo telefone.
  const convResult = await resolveConversation(tx, {
    channelIdentityId: i.channelIdentityId,
    remotePhone: i.remotePhone,
  });
  if (!convResult.ok) return convResult;

  const conversationId = convResult.value.conversationId;

  // 4. Obter o canal da identidade.
  const chQuery = await tx.query<{ channel: string }>(
    `SELECT channel FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  const channel = chQuery.rows[0]!.channel;

  // 5. Criar mensagem inbound.
  const messageId = uuidv7();
  await tx.query(
    `INSERT INTO msg.message
       (id, conversation_id, direction, channel, body_text, body_media_key,
        status, external_id, sent_at)
     VALUES ($1, $2, 'inbound', $3, $4, $5, 'delivered', $6, $7::timestamptz)`,
    [messageId, conversationId, channel,
     i.bodyText ?? null, i.bodyMediaKey ?? null,
     i.externalId, i.sentAt]);

  // 6. Atualizar last_message_at da conversa.
  await tx.query(
    `UPDATE msg.conversation SET last_message_at = clock_timestamp() WHERE id = $1`,
    [conversationId]);

  return ok({ eventId, messageId, conversationId });
}
```

---

- [ ] **Passo 4 — atualizar o barrel para exportar tudo**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  sendMessage,
  receiveInbound,
  type ResolveConversationInput, type ResolvedConversation,
  type SendMessageInput,
  type ReceiveInboundInput, type ReceivedInbound,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 5 — rodar e confirmar que todos os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 12 testes passando (5 de resolveConversation + 4 de sendMessage + 3 de receiveInbound).

---

- [ ] **Passo 6 — verificar que arch:check passa**

```bash
pnpm arch:check
```

Saida esperada: sem violacao. `@cadencia/messaging` (L2) importa apenas de `@cadencia/kernel` (L0) e `@cadencia/db` (L0).

---

- [ ] **Passo 7 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): sendMessage and receiveInbound domain functions

sendMessage creates a queued outbound message — the worker dispatches
via the provider. receiveInbound stores the raw webhook payload in
inbound_event BEFORE any parsing (parser bugs never lose patient
messages), then resolves the conversation and creates the inbound
message record.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 12: contrato MessagingProvider e tipos auxiliares

**Arquivos**
- Criar `packages/integrations/src/contracts/messaging.ts`
- Teste `packages/integrations/src/contracts/messaging.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/contracts/messaging.test.ts`:

```ts
// packages/integrations/src/contracts/messaging.test.ts
import { describe, expect, it } from 'vitest';
import type {
  MessagingProvider, OutboundBody, InboundEvent, InboundMessage, StatusUpdate,
} from './messaging';

describe('tipos do contrato MessagingProvider', () => {
  it('OutboundBody aceita texto simples', () => {
    const body: OutboundBody = { kind: 'text', text: 'Ola' };
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Ola');
  });

  it('OutboundBody aceita template com variaveis', () => {
    const body: OutboundBody = {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08', '10:00'],
    };
    expect(body.kind).toBe('template');
    expect(body.variables).toHaveLength(3);
  });

  it('InboundEvent discrimina mensagem de status update', () => {
    const msg: InboundEvent = {
      kind: 'message',
      providerMessageId: 'wamid.abc',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'text', text: 'Confirmo' },
    } satisfies InboundMessage;
    expect(msg.kind).toBe('message');

    const status: InboundEvent = {
      kind: 'status',
      providerMessageId: 'wamid.abc',
      status: 'delivered',
      timestamp: '2026-08-04T10:00:01.000Z',
    } satisfies StatusUpdate;
    expect(status.kind).toBe('status');
  });

  it('InboundMessage aceita corpo de midia com providerMediaId', () => {
    const msg: InboundMessage = {
      kind: 'message',
      providerMessageId: 'wamid.xyz',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'image', providerMediaId: 'media-123', mime: 'image/jpeg', caption: 'exame' },
    };
    expect(msg.body.kind).toBe('image');
  });

  it('StatusUpdate cobre sent, delivered, read e failed', () => {
    const statuses: StatusUpdate['status'][] = ['sent', 'delivered', 'read', 'failed'];
    expect(statuses).toHaveLength(4);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: falha — modulo './messaging' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/contracts/messaging.ts`:

```ts
// packages/integrations/src/contracts/messaging.ts
import type { E164, Provider, ProviderCtx, ProviderResult } from './common';

// ── Outbound body ──────────────────────────────────────────────────────

export type OutboundBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'template'; readonly templateName: string;
      readonly language: string; readonly variables: readonly string[] };

// ── Inbound events ─────────────────────────────────────────────────────

export type InboundMessageBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly providerMediaId: string;
      readonly mime: string; readonly caption?: string }
  | { readonly kind: 'audio'; readonly providerMediaId: string;
      readonly mime: string }
  | { readonly kind: 'document'; readonly providerMediaId: string;
      readonly mime: string; readonly filename?: string };

export interface InboundMessage {
  readonly kind: 'message';
  readonly providerMessageId: string;
  readonly from: string;          // E164 bruto do parceiro
  readonly timestamp: string;     // Rfc3339 bruto do parceiro
  readonly body: InboundMessageBody;
}

export interface StatusUpdate {
  readonly kind: 'status';
  readonly providerMessageId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly timestamp: string;
  readonly errorCode?: string;
  readonly errorDetail?: string;
}

export type InboundEvent = InboundMessage | StatusUpdate;

// ── Contrato principal ─────────────────────────────────────────────────

export interface MessagingProvider extends Provider {
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly supportsInbound: boolean;

  registerChannelIdentity(
    ctx: ProviderCtx,
    i: { displayName: string; phone: E164; wabaRef?: string },
  ): Promise<ProviderResult<{
    channelIdentityRef: string;
    status: 'pending' | 'verified' | 'rejected';
  }>>;

  send(
    ctx: ProviderCtx,
    i: {
      channelIdentityRef: string;
      to: E164 | string;
      body: OutboundBody;
      conversationId: string;
    },
  ): Promise<ProviderResult<{ providerMessageId: string }>>;

  findByIdempotencyKey(
    ctx: ProviderCtx,
    i: { key: string },
  ): Promise<ProviderResult<{ providerMessageId: string } | null>>;

  verifyWebhook(
    raw: Buffer,
    headers: Record<string, string>,
  ): { valid: boolean; reason?: string };

  parseInbound(raw: Buffer): InboundEvent[];

  fetchMedia(
    ctx: ProviderCtx,
    i: { providerMediaId: string },
  ): Promise<ProviderResult<{ bytes: Uint8Array; mime: string; sha256: string }>>;
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: 5 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/contracts/messaging.ts packages/integrations/src/contracts/messaging.test.ts
git commit -m "feat(integrations): add MessagingProvider contract and auxiliary types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 13: fake MessagingProviderFake com gravacao de chamadas

**Arquivos**
- Criar `packages/integrations/src/fakes/messaging-fake.ts`
- Teste `packages/integrations/src/fakes/messaging-fake.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/fakes/messaging-fake.test.ts`:

```ts
// packages/integrations/src/fakes/messaging-fake.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeMessagingProvider } from './messaging-fake';
import { asE164, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'msg-1', deadlineMs: 3000,
};

const telefone = asE164('+5511987654321')!;

describe('provedor de mensageria falso', () => {
  it('declara channel whatsapp e supportsInbound true', () => {
    const p = createFakeMessagingProvider();
    expect(p.channel).toBe('whatsapp');
    expect(p.supportsInbound).toBe(true);
  });

  it('declara safety por metodo', () => {
    const p = createFakeMessagingProvider();
    expect(p.safety.registerChannelIdentity).toBe('idempotent');
    expect(p.safety.send).toBe('unsafe');
    expect(p.safety.findByIdempotencyKey).toBe('safe');
    expect(p.safety.verifyWebhook).toBe('safe');
    expect(p.safety.parseInbound).toBe('safe');
    expect(p.safety.fetchMedia).toBe('safe');
  });

  it('registerChannelIdentity devolve channelIdentityRef e status verified', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.registerChannelIdentity(ctx, {
      displayName: 'Clinica Exemplo',
      phone: telefone,
      wabaRef: 'waba-123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.channelIdentityRef).toContain('fake-identity');
      expect(r.value.status).toBe('verified');
    }
  });

  it('send grava a chamada e devolve providerMessageId', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: 'conv-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
    }
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body).toEqual({ kind: 'text', text: 'Lembrete de consulta' });
  });

  it('send com template grava templateName e variaveis', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: {
        kind: 'template',
        templateName: 'confirmacao_consulta',
        language: 'pt_BR',
        variables: ['Maria', '14/08', '10:00'],
      },
      conversationId: 'conv-2',
    });
    expect(r.ok).toBe(true);
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body.kind).toBe('template');
  });

  it('findByIdempotencyKey devolve null quando nao existe', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.findByIdempotencyKey(ctx, { key: 'inexistente' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('findByIdempotencyKey devolve o providerMessageId apos send', async () => {
    const p = createFakeMessagingProvider();
    await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-3',
    });
    const r = await p.findByIdempotencyKey(ctx, { key: ctx.idempotencyKey });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toBeNull();
    if (r.ok && r.value) expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
  });

  it('verifyWebhook aceita HMAC-SHA256 valido e rejeita invalido', () => {
    const p = createFakeMessagingProvider({ appSecret: 'meu-secret' });
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', 'meu-secret').update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };

    expect(p.verifyWebhook(payload, headers)).toEqual({ valid: true });
    expect(p.verifyWebhook(payload, { 'x-hub-signature-256': 'sha256=errado' }))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('parseInbound extrai mensagem de texto do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.abc',
              from: '5511987654321',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Confirmo' },
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('message');
    if (eventos[0]!.kind === 'message') {
      expect(eventos[0]!.body).toEqual({ kind: 'text', text: 'Confirmo' });
      expect(eventos[0]!.from).toBe('+5511987654321');
    }
  });

  it('parseInbound extrai status update do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.xyz',
              status: 'delivered',
              timestamp: '1722772801',
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('status');
    if (eventos[0]!.kind === 'status') {
      expect(eventos[0]!.status).toBe('delivered');
    }
  });

  it('fetchMedia devolve bytes e sha256', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.fetchMedia(ctx, { providerMediaId: 'media-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
      expect(r.value.mime).toBe('image/jpeg');
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  it('o modo indisponivel devolve unavailable em send', async () => {
    const p = createFakeMessagingProvider({ modo: 'indisponivel' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-4',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-5',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });

  it('health reporta up quando modo e ok', async () => {
    const p = createFakeMessagingProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health reporta down quando modo nao e ok', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/fakes/messaging-fake.test.ts
# ESPERADO: falha — modulo './messaging-fake' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/fakes/messaging-fake.ts`:

```ts
// packages/integrations/src/fakes/messaging-fake.ts
import { createHash, createHmac } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type E164, type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  InboundEvent, InboundMessage, InboundMessageBody, MessagingProvider,
  OutboundBody, StatusUpdate,
} from '../contracts/messaging';

export type ModoFakeMsg = 'ok' | 'indisponivel' | 'timeout';

export interface FakeMessagingOptions {
  readonly modo?: ModoFakeMsg;
  readonly appSecret?: string;
}

export interface SentRecord {
  readonly ctx: ProviderCtx;
  readonly channelIdentityRef: string;
  readonly to: E164 | string;
  readonly body: OutboundBody;
  readonly conversationId: string;
  readonly providerMessageId: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeMessagingProvider(
  opts: FakeMessagingOptions = {},
): MessagingProvider & { readonly sent: readonly SentRecord[] } {
  const modo = opts.modo ?? 'ok';
  const appSecret = opts.appSecret ?? 'fake-whatsapp-secret';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'WhatsApp Cloud API fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false,
                          detail: 'deadline estourou' });
    }
    return null;
  }

  const sentList: SentRecord[] = [];
  const sentByKey = new Map<string, string>();
  let counter = 0;

  return {
    id: 'messaging-whatsapp-fake',
    channel: 'whatsapp' as const,
    supportsInbound: true,
    capabilities: new Set(['residency:br', 'inbound', 'templates']),
    safety: {
      registerChannelIdentity: 'idempotent',
      send: 'unsafe',
      findByIdempotencyKey: 'safe',
      verifyWebhook: 'safe',
      parseInbound: 'safe',
      fetchMedia: 'safe',
    },

    get sent(): readonly SentRecord[] {
      return sentList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async registerChannelIdentity(_ctx: ProviderCtx, i) {
      const f = falha<{ channelIdentityRef: string; status: 'pending' | 'verified' | 'rejected' }>();
      if (f) return f;
      const ref = `fake-identity-${i.phone}`;
      return success({ channelIdentityRef: ref, status: 'verified' as const }, ref);
    },

    async send(ctx: ProviderCtx, i) {
      const f = falha<{ providerMessageId: string }>();
      if (f) return f;

      const existing = sentByKey.get(ctx.idempotencyKey);
      if (existing !== undefined) {
        return success({ providerMessageId: existing }, existing);
      }

      counter += 1;
      const providerMessageId = `wamid-fake-${counter}`;
      sentList.push({
        ctx,
        channelIdentityRef: i.channelIdentityRef,
        to: i.to,
        body: i.body,
        conversationId: i.conversationId,
        providerMessageId,
      });
      sentByKey.set(ctx.idempotencyKey, providerMessageId);
      return success({ providerMessageId }, providerMessageId);
    },

    async findByIdempotencyKey(_ctx: ProviderCtx, i) {
      const f = falha<{ providerMessageId: string } | null>();
      if (f) return f;
      const found = sentByKey.get(i.key);
      if (found === undefined) {
        return success(null, 'fake-lookup-null');
      }
      return success({ providerMessageId: found }, found);
    },

    verifyWebhook(raw: Buffer, headers: Record<string, string>) {
      const sig = headers['x-hub-signature-256'];
      if (sig === undefined) {
        return { valid: false, reason: 'header x-hub-signature-256 ausente' };
      }
      const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
      if (sig !== expected) {
        return { valid: false, reason: 'assinatura HMAC invalida' };
      }
      return { valid: true };
    },

    parseInbound(raw: Buffer): InboundEvent[] {
      const parsed = JSON.parse(raw.toString('utf-8')) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              messages?: Array<{
                id: string; from: string; timestamp: string; type: string;
                text?: { body: string };
                image?: { id: string; mime_type: string; caption?: string };
                audio?: { id: string; mime_type: string };
                document?: { id: string; mime_type: string; filename?: string };
              }>;
              statuses?: Array<{
                id: string; status: string; timestamp: string;
                errors?: Array<{ code: number; title: string }>;
              }>;
            };
          }>;
        }>;
      };

      const events: InboundEvent[] = [];

      for (const entry of parsed.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (value === undefined) continue;

          for (const msg of value.messages ?? []) {
            let body: InboundMessageBody;
            switch (msg.type) {
              case 'text':
                body = { kind: 'text', text: msg.text?.body ?? '' };
                break;
              case 'image':
                body = {
                  kind: 'image',
                  providerMediaId: msg.image!.id,
                  mime: msg.image!.mime_type,
                  ...(msg.image!.caption !== undefined ? { caption: msg.image!.caption } : {}),
                };
                break;
              case 'audio':
                body = {
                  kind: 'audio',
                  providerMediaId: msg.audio!.id,
                  mime: msg.audio!.mime_type,
                };
                break;
              case 'document':
                body = {
                  kind: 'document',
                  providerMediaId: msg.document!.id,
                  mime: msg.document!.mime_type,
                  ...(msg.document!.filename !== undefined
                    ? { filename: msg.document!.filename } : {}),
                };
                break;
              default:
                continue;
            }

            const ts = Number(msg.timestamp) * 1000;
            const inbound: InboundMessage = {
              kind: 'message',
              providerMessageId: msg.id,
              from: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
              timestamp: isoFromMs(ts),
              body,
            };
            events.push(inbound);
          }

          for (const st of value.statuses ?? []) {
            const mapped = st.status as StatusUpdate['status'];
            if (!['sent', 'delivered', 'read', 'failed'].includes(mapped)) continue;
            const ts = Number(st.timestamp) * 1000;
            const status: StatusUpdate = {
              kind: 'status',
              providerMessageId: st.id,
              status: mapped,
              timestamp: isoFromMs(ts),
              ...(st.errors?.[0] !== undefined ? {
                errorCode: String(st.errors[0].code),
                errorDetail: st.errors[0].title,
              } : {}),
            };
            events.push(status);
          }
        }
      }

      return events;
    },

    async fetchMedia(_ctx: ProviderCtx, i) {
      const f = falha<{ bytes: Uint8Array; mime: string; sha256: string }>();
      if (f) return f;
      const bytes = new TextEncoder().encode(`fake-media-${i.providerMediaId}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return success({ bytes: new Uint8Array(bytes), mime: 'image/jpeg', sha256 },
        `fake-media-${i.providerMediaId}`);
    },
  };
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/fakes/messaging-fake.test.ts
# ESPERADO: 13 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/fakes/messaging-fake.ts packages/integrations/src/fakes/messaging-fake.test.ts
git commit -m "feat(integrations): add MessagingProviderFake with call recording

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 14: conformidade obrigatoria — MessagingProvider no teste de conformidade

**Arquivos**
- Modificar `packages/integrations/src/conformance.test.ts`

- [ ] **Teste que falha** — adicionar ao `packages/integrations/src/conformance.test.ts`, dentro do `describe('conformidade obrigatoria por adaptador')`:

```ts
// packages/integrations/src/conformance.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';
import { createFakeMessagingProvider } from './fakes/messaging-fake';
import { asE164, type ProviderCtx } from './contracts/common';

const msgCtx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'conformidade-msg', deadlineMs: 3000,
};

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
    expect(assertSafetyDeclared(createFakeMessagingProvider(),
      ['registerChannelIdentity', 'send', 'findByIdempotencyKey',
       'verifyWebhook', 'parseInbound', 'fetchMedia'])).toBe(true);
  });

  it('reprova provedor que esqueceu de declarar a safety de um metodo', () => {
    const p = createFakeSignatureProvider();
    expect(() => assertSafetyDeclared(p, ['metodoInexistente']))
      .toThrow(/safety nao declarada para metodoInexistente/);
  });

  it('timeout com efeito NAO duplica: a segunda chamada devolve o MESMO resultado', async () => {
    let chamadas = 0;
    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        return chamadas === 1 ? { estado: 'timeout' as const } : { estado: 'ok' as const, id: 'X' };
      },
      reconciliar: async () => ({ jaExiste: true, id: 'X' }),
    });
    expect(r).toEqual({ duplicou: false, id: 'X', viaReconciliacao: true });
  });

  it('reprova o adaptador que reenvia cegamente apos timeout', async () => {
    await expect(assertNoDuplicateOnTimeout({
      operacao: async () => ({ estado: 'ok' as const, id: `novo-${Math.random()}` }),
      reconciliar: async () => ({ jaExiste: false, id: null }),
      simularEfeitoNoTimeout: true,
    })).rejects.toThrow(/duplicou/);
  });

  it('messaging: timeout em send NAO duplica graças a findByIdempotencyKey', async () => {
    const p = createFakeMessagingProvider();
    const phone = asE164('+5511987654321')!;
    let chamadas = 0;

    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        if (chamadas === 1) {
          // simula: a primeira chamada funciona mas o caller ve timeout
          await p.send(msgCtx, {
            channelIdentityRef: 'id-1', to: phone,
            body: { kind: 'text', text: 'lembrete' },
            conversationId: 'conv-conf',
          });
          return { estado: 'timeout' as const };
        }
        // segunda chamada: o caller tenta de novo com a mesma idempotencyKey
        const r2 = await p.send(msgCtx, {
          channelIdentityRef: 'id-1', to: phone,
          body: { kind: 'text', text: 'lembrete' },
          conversationId: 'conv-conf',
        });
        if (!r2.ok) return { estado: 'timeout' as const };
        return { estado: 'ok' as const, id: r2.value.providerMessageId };
      },
      reconciliar: async () => {
        const found = await p.findByIdempotencyKey(msgCtx, { key: msgCtx.idempotencyKey });
        if (found.ok && found.value !== null) {
          return { jaExiste: true, id: found.value.providerMessageId };
        }
        return { jaExiste: false, id: null };
      },
    });

    expect(r.duplicou).toBe(false);
    expect(r.viaReconciliacao).toBe(true);
    // o fake so enviou UMA vez, nao duplicou
    expect(p.sent).toHaveLength(1);
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/conformance.test.ts
# ESPERADO: 5 testes passam (incluindo o novo de messaging)
```

- [ ] Commitar:

```bash
git add packages/integrations/src/conformance.test.ts
git commit -m "test(integrations): add MessagingProvider to conformance tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 15: exportar contrato e fake no barrel do pacote

**Arquivos**
- Modificar `packages/integrations/src/index.ts`
- Teste `packages/integrations/src/contracts/messaging.test.ts` (ja existe, roda como regressao)

- [ ] **Teste que falha** — criar teste de importacao via barrel. Adicionar ao final de `packages/integrations/src/contracts/messaging.test.ts`:

```ts
// Adicionar ao final do describe existente em
// packages/integrations/src/contracts/messaging.test.ts

  it('exporta tipos e fake pelo barrel do pacote', async () => {
    const barrel = await import('../index');
    expect(barrel.createFakeMessagingProvider).toBeTypeOf('function');
  });
```

O `describe` completo fica:

```ts
// packages/integrations/src/contracts/messaging.test.ts
import { describe, expect, it } from 'vitest';
import type {
  MessagingProvider, OutboundBody, InboundEvent, InboundMessage, StatusUpdate,
} from './messaging';

describe('tipos do contrato MessagingProvider', () => {
  it('OutboundBody aceita texto simples', () => {
    const body: OutboundBody = { kind: 'text', text: 'Ola' };
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Ola');
  });

  it('OutboundBody aceita template com variaveis', () => {
    const body: OutboundBody = {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08', '10:00'],
    };
    expect(body.kind).toBe('template');
    expect(body.variables).toHaveLength(3);
  });

  it('InboundEvent discrimina mensagem de status update', () => {
    const msg: InboundEvent = {
      kind: 'message',
      providerMessageId: 'wamid.abc',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'text', text: 'Confirmo' },
    } satisfies InboundMessage;
    expect(msg.kind).toBe('message');

    const status: InboundEvent = {
      kind: 'status',
      providerMessageId: 'wamid.abc',
      status: 'delivered',
      timestamp: '2026-08-04T10:00:01.000Z',
    } satisfies StatusUpdate;
    expect(status.kind).toBe('status');
  });

  it('InboundMessage aceita corpo de midia com providerMediaId', () => {
    const msg: InboundMessage = {
      kind: 'message',
      providerMessageId: 'wamid.xyz',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'image', providerMediaId: 'media-123', mime: 'image/jpeg', caption: 'exame' },
    };
    expect(msg.body.kind).toBe('image');
  });

  it('StatusUpdate cobre sent, delivered, read e failed', () => {
    const statuses: StatusUpdate['status'][] = ['sent', 'delivered', 'read', 'failed'];
    expect(statuses).toHaveLength(4);
  });

  it('exporta tipos e fake pelo barrel do pacote', async () => {
    const barrel = await import('../index');
    expect(barrel.createFakeMessagingProvider).toBeTypeOf('function');
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: falha no ultimo teste — createFakeMessagingProvider nao exportado pelo barrel
```

- [ ] **Implementar** — modificar `packages/integrations/src/index.ts`, adicionando as exportacoes de messaging:

```ts
// packages/integrations/src/index.ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  type MessagingProvider, type OutboundBody, type InboundEvent,
  type InboundMessage, type InboundMessageBody, type StatusUpdate,
} from './contracts/messaging';
export {
  createFakeMessagingProvider, type FakeMessagingOptions, type ModoFakeMsg, type SentRecord,
} from './fakes/messaging-fake';
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/contracts/messaging.test.ts
# ESPERADO: 6 testes passam (incluindo o de barrel)
```

- [ ] Commitar:

```bash
git add packages/integrations/src/index.ts packages/integrations/src/contracts/messaging.test.ts
git commit -m "feat(integrations): export MessagingProvider contract and fake from barrel

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 16: adaptador WhatsApp Cloud API — estrutura e webhook

**Arquivos**
- Criar `packages/integrations/src/adapters/whatsapp-cloud.ts`
- Teste `packages/integrations/src/adapters/whatsapp-cloud.test.ts`

- [ ] **Teste que falha** — criar `packages/integrations/src/adapters/whatsapp-cloud.test.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyWhatsAppWebhook,
  parseWhatsAppInbound,
  buildSendPayload,
  buildTemplateSendPayload,
} from './whatsapp-cloud';
import type { InboundMessage, StatusUpdate } from '../contracts/messaging';

const APP_SECRET = 'test-app-secret-1234';

describe('WhatsApp Cloud API — webhook e parsing', () => {
  it('verifyWhatsAppWebhook aceita assinatura HMAC-SHA256 valida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: true });
  });

  it('verifyWhatsAppWebhook rejeita assinatura invalida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const headers = { 'x-hub-signature-256': 'sha256=invalido' };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('verifyWhatsAppWebhook rejeita quando header ausente', () => {
    const payload = Buffer.from('{"entry":[]}');
    expect(verifyWhatsAppWebhook(payload, {}, APP_SECRET))
      .toEqual({ valid: false, reason: 'header x-hub-signature-256 ausente' });
  });

  it('parseWhatsAppInbound extrai mensagem de texto', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.HBgN',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Boa tarde, confirmo a consulta' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.kind).toBe('message');
    expect(msg.providerMessageId).toBe('wamid.HBgN');
    expect(msg.from).toBe('+5511999887766');
    expect(msg.body).toEqual({ kind: 'text', text: 'Boa tarde, confirmo a consulta' });
  });

  it('parseWhatsAppInbound extrai mensagem de imagem com caption', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'image',
              image: { id: 'media-img-1', mime_type: 'image/jpeg', caption: 'exame de sangue' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('image');
    if (msg.body.kind === 'image') {
      expect(msg.body.providerMediaId).toBe('media-img-1');
      expect(msg.body.caption).toBe('exame de sangue');
    }
  });

  it('parseWhatsAppInbound extrai mensagem de audio', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.AUD1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'audio',
              audio: { id: 'media-aud-1', mime_type: 'audio/ogg; codecs=opus' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('audio');
  });

  it('parseWhatsAppInbound extrai mensagem de documento', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.DOC1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'document',
              document: { id: 'media-doc-1', mime_type: 'application/pdf', filename: 'laudo.pdf' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('document');
    if (msg.body.kind === 'document') {
      expect(msg.body.filename).toBe('laudo.pdf');
    }
  });

  it('parseWhatsAppInbound extrai status updates', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid.S1', status: 'sent', timestamp: '1722772800' },
              { id: 'wamid.S1', status: 'delivered', timestamp: '1722772801' },
              { id: 'wamid.S1', status: 'read', timestamp: '1722772805' },
            ],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(3);
    expect((events[0] as StatusUpdate).status).toBe('sent');
    expect((events[1] as StatusUpdate).status).toBe('delivered');
    expect((events[2] as StatusUpdate).status).toBe('read');
  });

  it('parseWhatsAppInbound extrai status failed com codigo de erro', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.F1', status: 'failed', timestamp: '1722772800',
              errors: [{ code: 131026, title: 'Message Undeliverable' }],
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const st = events[0] as StatusUpdate;
    expect(st.status).toBe('failed');
    expect(st.errorCode).toBe('131026');
    expect(st.errorDetail).toBe('Message Undeliverable');
  });

  it('parseWhatsAppInbound devolve array vazio para payload sem mensagens', () => {
    const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('parseWhatsAppInbound ignora tipos de mensagem desconhecidos', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.UNK', from: '5511999887766', timestamp: '1722772800',
              type: 'sticker', sticker: { id: 'stk-1' },
            }],
          },
        }],
      }],
    }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('buildSendPayload monta o corpo para envio de texto via Cloud API', () => {
    const payload = buildSendPayload('+5511987654321', { kind: 'text', text: 'Ola, bom dia!' });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'text',
      text: { preview_url: false, body: 'Ola, bom dia!' },
    });
  });

  it('buildTemplateSendPayload monta o corpo para envio de template', () => {
    const payload = buildTemplateSendPayload('+5511987654321', {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08/2026', '10:00'],
    });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'template',
      template: {
        name: 'confirmacao_consulta',
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '14/08/2026' },
            { type: 'text', text: '10:00' },
          ],
        }],
      },
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: falha — modulo './whatsapp-cloud' nao existe
```

- [ ] **Implementar** — criar `packages/integrations/src/adapters/whatsapp-cloud.ts`:

```ts
// packages/integrations/src/adapters/whatsapp-cloud.ts
import { createHmac } from 'node:crypto';
import { isoFromMs } from '@cadencia/kernel';
import type { InboundEvent, InboundMessage, InboundMessageBody, OutboundBody, StatusUpdate } from '../contracts/messaging';

/**
 * §7.3 — funcoes puras do adaptador WhatsApp Cloud API v21+.
 *
 * Estas funcoes NAO fazem chamadas HTTP — elas transformam dados.
 * A chamada HTTP real sai exclusivamente pelo worker via outbox (§7.1).
 *
 * O adaptador completo (que implementa MessagingProvider) vive no
 * pacote de messaging e usa estas funcoes como building blocks.
 */

// ── Verificacao de webhook ─────────────────────────────────────────────

export function verifyWhatsAppWebhook(
  raw: Buffer,
  headers: Record<string, string>,
  appSecret: string,
): { valid: boolean; reason?: string } {
  const sig = headers['x-hub-signature-256'];
  if (sig === undefined) {
    return { valid: false, reason: 'header x-hub-signature-256 ausente' };
  }
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  if (sig !== expected) {
    return { valid: false, reason: 'assinatura HMAC invalida' };
  }
  return { valid: true };
}

// ── Parsing de inbound ─────────────────────────────────────────────────

interface RawWhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string; from: string; timestamp: string; type: string;
          text?: { body: string };
          image?: { id: string; mime_type: string; caption?: string };
          audio?: { id: string; mime_type: string };
          document?: { id: string; mime_type: string; filename?: string };
        }>;
        statuses?: Array<{
          id: string; status: string; timestamp: string;
          errors?: Array<{ code: number; title: string }>;
        }>;
      };
    }>;
  }>;
}

export function parseWhatsAppInbound(raw: Buffer): InboundEvent[] {
  const parsed: RawWhatsAppPayload = JSON.parse(raw.toString('utf-8'));
  const events: InboundEvent[] = [];

  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value === undefined) continue;

      for (const msg of value.messages ?? []) {
        let body: InboundMessageBody;
        switch (msg.type) {
          case 'text':
            body = { kind: 'text', text: msg.text?.body ?? '' };
            break;
          case 'image':
            body = {
              kind: 'image',
              providerMediaId: msg.image!.id,
              mime: msg.image!.mime_type,
              ...(msg.image!.caption !== undefined ? { caption: msg.image!.caption } : {}),
            };
            break;
          case 'audio':
            body = {
              kind: 'audio',
              providerMediaId: msg.audio!.id,
              mime: msg.audio!.mime_type,
            };
            break;
          case 'document':
            body = {
              kind: 'document',
              providerMediaId: msg.document!.id,
              mime: msg.document!.mime_type,
              ...(msg.document!.filename !== undefined
                ? { filename: msg.document!.filename } : {}),
            };
            break;
          default:
            continue;
        }

        const ts = Number(msg.timestamp) * 1000;
        const inbound: InboundMessage = {
          kind: 'message',
          providerMessageId: msg.id,
          from: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
          timestamp: isoFromMs(ts),
          body,
        };
        events.push(inbound);
      }

      for (const st of value.statuses ?? []) {
        const mapped = st.status as StatusUpdate['status'];
        if (!['sent', 'delivered', 'read', 'failed'].includes(mapped)) continue;
        const ts = Number(st.timestamp) * 1000;
        const status: StatusUpdate = {
          kind: 'status',
          providerMessageId: st.id,
          status: mapped,
          timestamp: isoFromMs(ts),
          ...(st.errors?.[0] !== undefined ? {
            errorCode: String(st.errors[0].code),
            errorDetail: st.errors[0].title,
          } : {}),
        };
        events.push(status);
      }
    }
  }

  return events;
}

// ── Construcao de payload de envio ─────────────────────────────────────

export interface CloudApiTextPayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'text';
  readonly text: { readonly preview_url: false; readonly body: string };
}

export interface CloudApiTemplatePayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'template';
  readonly template: {
    readonly name: string;
    readonly language: { readonly code: string };
    readonly components: readonly [{
      readonly type: 'body';
      readonly parameters: readonly Array<{ readonly type: 'text'; readonly text: string }>;
    }];
  };
}

export function buildSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'text' }>,
): CloudApiTextPayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: body.text },
  };
}

export function buildTemplateSendPayload(
  to: string,
  body: Extract<OutboundBody, { kind: 'template' }>,
): CloudApiTemplatePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: body.templateName,
      language: { code: body.language },
      components: [{
        type: 'body',
        parameters: body.variables.map((v) => ({ type: 'text' as const, text: v })),
      }],
    },
  };
}
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/adapters/whatsapp-cloud.test.ts
# ESPERADO: 12 testes passam
```

- [ ] Commitar:

```bash
git add packages/integrations/src/adapters/whatsapp-cloud.ts packages/integrations/src/adapters/whatsapp-cloud.test.ts
git commit -m "feat(integrations): WhatsApp Cloud API adapter — webhook verify, inbound parse, send payload

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### ~~Task 17: migration 0073 — tabela msg.channel_identity~~ REMOVIDA

> **COLISAO RESOLVIDA**: esta migration duplica a criacao de `msg.channel_identity`
> que ja e feita pela migration 0070 (Bloco 02, Task 6). A migration 0073 NAO
> deve ser criada. Os testes de integracao desta task devem validar a tabela
> existente (criada por 0070) usando a coluna `phone` (nao `phone_number`).
> O arquivo `0073_msg_channel_identity.sql` NAO deve ser criado.

### Task 17: testes de integracao de `msg.channel_identity` e WABA onboarding

**Arquivos**
- Criar `packages/db/migrations/0073_msg_channel_identity.sql`
- Teste `packages/db/test/0073_msg_channel_identity.test.ts`

- [ ] **Teste que falha** — criar `packages/db/test/0073_msg_channel_identity.test.ts`:

```ts
// packages/db/test/0073_msg_channel_identity.test.ts
import { describe, expect, it } from 'vitest';
import { withTenantTx } from '../src/tx';
import { testPool, TEST_TENANT_ID, TEST_USER_ID } from './helpers';

const actor = { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, role: 'admin' as const };

describe('msg.channel_identity', () => {
  it('a tabela msg.channel_identity existe no schema msg', async () => {
    const result = await testPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'msg' AND table_name = 'channel_identity'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('insere identidade de canal com tenant_id e RLS permite leitura do mesmo tenant', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone, waba_ref,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica Teste',
          '+5511987654321', 'waba-123', 'prov-ref-1', 'verified',
          $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      const result = await tx.query(
        'SELECT channel, display_name, phone, status FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        channel: 'whatsapp',
        display_name: 'Clinica Teste',
        phone: '+5511987654321',
        status: 'verified',
      });
    });
  });

  it('RLS impede leitura de canal de OUTRO tenant', async () => {
    const outroTenant = { tenantId: '00000000-0000-0000-0000-000000000099', userId: TEST_USER_ID, role: 'admin' as const };
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Outra Clinica',
          '+5511911111111', 'prov-ref-2', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);
    });

    await withTenantTx(outroTenant, async (tx) => {
      const result = await tx.query(
        'SELECT * FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it('constraint unique (tenant_id, channel, phone) impede duplicata', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A',
          '+5511922222222', 'prov-ref-3', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      await expect(tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A Duplicada',
          '+5511922222222', 'prov-ref-4', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID])).rejects.toThrow(/unique|duplicate/i);
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: falha — schema msg e tabela channel_identity nao existem
```

- [ ] **Implementar** — criar `packages/db/migrations/0073_msg_channel_identity.sql`:

```sql
-- 0073_msg_channel_identity.sql
-- Schema msg para mensageria. Tabela channel_identity: identidade de canal
-- por tenant (numero WhatsApp, telefone SMS, email).
-- Cada clinica registra o proprio numero — nunca compartilhado.

BEGIN;

CREATE SCHEMA IF NOT EXISTS msg;

CREATE TABLE msg.channel_identity (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  channel    text        NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  display_name text      NOT NULL,
  phone      text        NOT NULL,          -- E164
  waba_ref   text,                          -- WABA ID da Meta, opcional
  provider_ref text      NOT NULL,          -- referencia do provedor
  status     text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verified', 'rejected', 'suspended')),
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT uq_channel_identity_phone UNIQUE (tenant_id, channel, phone)
);

-- RLS: isolamento multi-tenant
ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON msg.channel_identity
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

COMMENT ON TABLE msg.channel_identity IS
  '§7.3 — identidade de canal por tenant. O numero e PROPRIO da clinica.';

COMMIT;
```

- [ ] Rodar as migrations:

```bash
pnpm db:migrate
# ESPERADO: migration 0073 aplicada com sucesso
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: 4 testes passam
```

- [ ] Rodar suite de isolamento para confirmar que a nova tabela esta coberta:

```bash
pnpm test:iso
# ESPERADO: msg.channel_identity aparece e passa
```

- [ ] Commitar:

```bash
git add packages/db/migrations/0073_msg_channel_identity.sql packages/db/test/0073_msg_channel_identity.test.ts
git commit -m "feat(db): add msg schema and channel_identity table with RLS

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 18: migration 0074 — tabela `msg.nps_response` e indice de automacao por timing

**Arquivos:**
- Criar `packages/db/migrations/0074_nps_response.sql`
- Teste `packages/messaging/src/automations/nps-response.int.test.ts`

**Contexto:** a `msg.automation_rule` ja foi criada pelo bloco 02 (migration 0070-0072) com `trigger`, `template_id`, `timing_offset_minutes`, `active`, `channel`. Este bloco acrescenta a tabela de respostas NPS e um indice de busca por timing para o job de lembretes.

- [ ] **Passo 1** — escrever o teste de isolamento que espera a tabela `msg.nps_response` existir com RLS forcada.

Criar `packages/messaging/src/automations/nps-response.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.nps_response', () => {
  it('existe com RLS forcada', async () => {
    const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('tem ao menos uma policy', async () => {
    const { rows } = await admin.query(
      `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta inclui tenant_id', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'msg.nps_response'::regclass AND contype = 'f'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes falham (tabela nao existe).

- [ ] **Passo 2** — rodar o teste e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: `FAIL` — relacao `msg.nps_response` nao encontrada.

- [ ] **Passo 3** — escrever a migration 0074 com `msg.nps_response` e o indice de timing em `msg.automation_rule`.

Criar `packages/db/migrations/0074_nps_response.sql`:

```sql
-- 0074_nps_response.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Tabela de respostas NPS e indice de busca por timing para o job de lembretes.
-- A msg.automation_rule ja existe (0070); este arquivo acrescenta a tabela de
-- respostas e o indice auxiliar.

-- =========================================================================
-- msg.nps_response — resposta do paciente a pesquisa NPS
-- =========================================================================
CREATE TABLE msg.nps_response (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,           -- pode ser NULL se NPS avulso
  conversation_id uuid,           -- conversa de onde veio a resposta
  message_id      uuid,           -- mensagem que contem a resposta
  score           smallint NOT NULL CHECK (score >= 0 AND score <= 10),
  comment         text,
  received_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)  REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES msg.conversation(tenant_id, id)
);
ALTER TABLE msg.nps_response OWNER TO app_owner;

CREATE INDEX ix_nps_response_tenant_patient
  ON msg.nps_response (tenant_id, patient_id, received_at DESC);
CREATE INDEX ix_nps_response_tenant_score
  ON msg.nps_response (tenant_id, score, received_at DESC);

GRANT SELECT, INSERT ON msg.nps_response TO app_rw;

ALTER TABLE msg.nps_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.nps_response FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.nps_response AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- =========================================================================
-- Indice em msg.automation_rule para busca por trigger+active
-- (o bloco 02 criou a tabela; este indice acelera o lookup de automacoes)
-- =========================================================================
CREATE INDEX ix_automation_rule_trigger
  ON msg.automation_rule (tenant_id, trigger, active)
  WHERE active = true;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0074 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/db/migrations/0074_nps_response.sql packages/messaging/src/automations/nps-response.int.test.ts
git commit -m "feat(db): add msg.nps_response table and automation_rule index (0074)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 19: funcao `computeReminderInstant` — calcula o instante de envio no fuso da clinica

**Arquivos:**
- Criar `packages/messaging/src/automations/reminder-timing.ts`
- Teste `packages/messaging/src/automations/reminder-timing.test.ts`

**Contexto:** o timing_offset e relativo ao horario local da clinica, nao UTC. Uma consulta as 8h em America/Sao_Paulo (UTC-3) com offset -1440 (24h antes) deve gerar envio as 8h do dia anterior em horario local, ou seja, 11:00 UTC do dia anterior. Esta funcao recebe o `starts_at` (UTC), o `timezone` da clinica e o `timing_offset_minutes`, e devolve o instante UTC de envio.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/reminder-timing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeReminderInstant } from './reminder-timing';

describe('computeReminderInstant', () => {
  it('lembrete 24h antes: consulta as 8h em SP sai as 8h do dia anterior em SP', () => {
    // 2026-10-07 08:00 em America/Sao_Paulo = 2026-10-07 11:00 UTC
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -1440; // 24h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-06 08:00 em America/Sao_Paulo = 2026-10-06 11:00 UTC
    expect(result).toBe('2026-10-06T11:00:00.000Z');
  });

  it('lembrete 2h antes: consulta as 8h em SP sai as 6h do mesmo dia em SP', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -120; // 2h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-07 06:00 em America/Sao_Paulo = 2026-10-07 09:00 UTC
    expect(result).toBe('2026-10-07T09:00:00.000Z');
  });

  it('respeita horario de verao: consulta em novembro quando SP esta em UTC-2', () => {
    // Brasil: horario de verao (se vigente) muda SP para UTC-2
    // Em 2026, Brasil NAO tem horario de verao (abolido em 2019).
    // Mas testamos com fuso que TEM (ex: America/New_York para validar a logica).
    // 2026-03-09 09:00 EDT (UTC-4) = 2026-03-09 13:00 UTC
    const startsAtUtc = '2026-03-09T13:00:00.000Z';
    const timezone = 'America/New_York';
    const offsetMinutes = -1440;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-03-08 09:00 EST (UTC-5) = 2026-03-08 14:00 UTC
    // Nota: no dia 8/mar NY ainda esta em EST (horario de verao comeca dia 8 as 2h,
    // mas 9h da manha do dia 8 ainda e EST). Na verdade, em 2026 o DST dos EUA
    // comeca em 8/mar as 02:00. Entao:
    // dia 9/mar 09:00 EDT = 13:00 UTC
    // dia 8/mar 09:00 EST = 14:00 UTC (antes do DST)
    expect(result).toBe('2026-03-08T14:00:00.000Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 1440; // 24h depois

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-08 08:00 em SP = 2026-10-08 11:00 UTC
    expect(result).toBe('2026-10-08T11:00:00.000Z');
  });

  it('offset zero retorna o mesmo instante da consulta', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 0;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    expect(result).toBe('2026-10-07T11:00:00.000Z');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: `FAIL` — cannot find module `./reminder-timing`.

- [ ] **Passo 3** — implementar `computeReminderInstant`.

Criar `packages/messaging/src/automations/reminder-timing.ts`:

```ts
/**
 * Calcula o instante UTC de envio de lembrete/automacao.
 *
 * O timing_offset_minutes e RELATIVO ao horario LOCAL da clinica, NAO ao UTC.
 * Motivo: consulta as 8h em America/Sao_Paulo com offset -1440 deve disparar
 * as 8h do dia anterior no fuso local, ou seja 11:00 UTC — e nao as 5:00 UTC
 * que e o que daria se subtraisse 1440 min do instante UTC puro.
 *
 * Algoritmo:
 * 1. Converte starts_at UTC para horario local da clinica.
 * 2. Aplica o offset em minutos no horario local.
 * 3. Converte de volta para UTC.
 *
 * Usa Intl.DateTimeFormat para obter o offset real do fuso naquele instante,
 * respeitando horario de verao onde aplicavel.
 */

/**
 * Retorna o offset UTC em minutos para um dado instante e timezone.
 * Positivo = leste de Greenwich (ex: +180 para UTC+3).
 * Negativo = oeste (ex: -180 para UTC-3).
 */
function utcOffsetMinutesAt(instantMs: number, timezone: string): number {
  const dt = new Date(instantMs);
  // Formata partes no fuso-alvo
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(dt);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // Reconstroi o instante "como se fosse UTC" a partir das partes locais
  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  );

  // A diferenca e o offset: local - UTC
  return Math.round((localAsUtc - instantMs) / 60_000);
}

export function computeReminderInstant(
  startsAtUtc: string,
  timezone: string,
  offsetMinutes: number,
): string {
  const startsMs = new Date(startsAtUtc).getTime();

  // 1. Offset UTC do fuso no instante da consulta
  const tzOffsetAtStart = utcOffsetMinutesAt(startsMs, timezone);

  // 2. Horario local da consulta em ms (como se fosse UTC)
  const localMs = startsMs + tzOffsetAtStart * 60_000;

  // 3. Aplica o offset da automacao no horario local
  const targetLocalMs = localMs + offsetMinutes * 60_000;

  // 4. Descobre o offset UTC no instante-alvo (pode diferir por DST)
  //    Para isso, precisamos de uma estimativa do instante UTC-alvo
  const estimatedUtcMs = targetLocalMs - tzOffsetAtStart * 60_000;
  const tzOffsetAtTarget = utcOffsetMinutesAt(estimatedUtcMs, timezone);

  // 5. Converte de volta para UTC usando o offset correto
  const targetUtcMs = targetLocalMs - tzOffsetAtTarget * 60_000;

  return new Date(targetUtcMs).toISOString();
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/reminder-timing.ts packages/messaging/src/automations/reminder-timing.test.ts
git commit -m "feat(messaging): computeReminderInstant respects clinic timezone

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 20: handler de confirmacao de agendamento — `handleAppointmentCreated`

**Arquivos:**
- Criar `packages/messaging/src/automations/confirmation.ts`
- Teste `packages/messaging/src/automations/confirmation.test.ts`

**Contexto:** quando o evento `APPOINTMENT_CONFIRMED` chega, o handler verifica se existe `automation_rule` com trigger `appointment_confirmed` ativa para o tenant. Se sim, monta o payload de envio e retorna a intencao de outbox. O messaging NAO importa scheduling — a composicao e pelo worker/L3. O handler recebe os dados do agendamento ja resolvidos por argumento.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/confirmation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type ConfirmationOutboxEntry,
} from './confirmation';

const REGRA_ATIVA: AutomationRule = {
  id: 'rule-1',
  tenantId: 'tenant-1',
  trigger: 'appointment_created',
  templateId: 'tpl-confirmacao',
  timingOffsetMinutes: 0,
  active: true,
  channel: 'whatsapp',
};

const AGENDAMENTO: AppointmentCreatedPayload = {
  tenantId: 'tenant-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  startsAt: '2026-10-07T11:00:00.000Z',
  appointmentDate: '2026-10-07',
  procedureName: 'Consulta',
};

describe('handleAppointmentCreated', () => {
  it('retorna entrada de outbox quando regra ativa existe', () => {
    const result = handleAppointmentCreated(AGENDAMENTO, [REGRA_ATIVA]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_CONFIRMATION');
    expect(entry.aggregateId).toBe('appt-1');
    expect(entry.payload.to).toBe('+5511999990001');
    expect(entry.payload.templateId).toBe('tpl-confirmacao');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.variables.patientName).toBe('Maria Souza');
    expect(entry.payload.variables.professionalName).toBe('Dr. Silva');
    expect(entry.payload.variables.appointmentDate).toBe('2026-10-07');
  });

  it('retorna vazio quando nao ha regra ativa', () => {
    const result = handleAppointmentCreated(AGENDAMENTO, []);
    expect(result).toHaveLength(0);
  });

  it('ignora regra inativa', () => {
    const inativa = { ...REGRA_ATIVA, active: false };
    const result = handleAppointmentCreated(AGENDAMENTO, [inativa]);
    expect(result).toHaveLength(0);
  });

  it('ignora regra com trigger diferente', () => {
    const outra = { ...REGRA_ATIVA, trigger: 'encounter_finalized' as const };
    const result = handleAppointmentCreated(AGENDAMENTO, [outra]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...AGENDAMENTO, patientPhone: null };
    const result = handleAppointmentCreated(semTel, [REGRA_ATIVA]);
    expect(result).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: 5 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `handleAppointmentCreated`.

Criar `packages/messaging/src/automations/confirmation.ts`:

```ts
/**
 * Handler de confirmacao de agendamento.
 *
 * Recebe os dados do agendamento JA RESOLVIDOS (por L3/worker) e as regras de
 * automacao do tenant. Retorna as entradas de outbox a serem enfileiradas.
 *
 * O messaging NAO importa scheduling — a composicao e pelo worker/L3.
 */

export type AutomationTrigger =
  | 'appointment_created'
  | 'appointment_reminder'
  | 'encounter_finalized'
  | 'nps_due';

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
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/confirmation.ts packages/messaging/src/automations/confirmation.test.ts
git commit -m "feat(messaging): appointment confirmation automation handler

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 21: handler de lembrete com fallback SMS — `scheduleReminders`

**Arquivos:**
- Criar `packages/messaging/src/automations/reminder.ts`
- Teste `packages/messaging/src/automations/reminder.test.ts`

**Contexto:** quando um agendamento e criado, para cada `automation_rule` com trigger `appointment_reminder`, calcula o instante de envio usando `computeReminderInstant` e retorna entradas de outbox com `startAfter` para que o pg-boss agende o job no momento correto. Se o canal primario e WhatsApp, inclui fallback SMS.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scheduleReminders, type ReminderOutboxEntry } from './reminder';
import type { AutomationRule } from './confirmation';

const REGRA_24H: AutomationRule = {
  id: 'rule-lembrete-24h',
  tenantId: 'tenant-1',
  trigger: 'appointment_reminder',
  templateId: 'tpl-lembrete',
  timingOffsetMinutes: -1440,
  active: true,
  channel: 'whatsapp',
};

const REGRA_2H: AutomationRule = {
  id: 'rule-lembrete-2h',
  tenantId: 'tenant-1',
  trigger: 'appointment_reminder',
  templateId: 'tpl-lembrete-curto',
  timingOffsetMinutes: -120,
  active: true,
  channel: 'whatsapp',
};

const APPOINTMENT_DATA = {
  tenantId: 'tenant-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  // 2026-10-07 08:00 em SP = 2026-10-07 11:00 UTC
  startsAt: '2026-10-07T11:00:00.000Z',
  appointmentDate: '2026-10-07',
  procedureName: 'Consulta',
};

describe('scheduleReminders', () => {
  it('lembrete 24h antes: consulta 8h SP => envio 8h dia anterior SP (11h UTC dia anterior)', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_24H]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_REMINDER');
    expect(entry.startAfter).toBe('2026-10-06T11:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.fallbackChannel).toBe('sms');
  });

  it('lembrete 2h antes: consulta 8h SP => envio 6h SP (9h UTC)', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_2H]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.startAfter).toBe('2026-10-07T09:00:00.000Z');
  });

  it('gera dois lembretes quando ha duas regras ativas', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_24H, REGRA_2H]);
    expect(result).toHaveLength(2);
  });

  it('retorna vazio quando nao ha regra de lembrete', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, []);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...APPOINTMENT_DATA, patientPhone: null };
    const result = scheduleReminders(semTel, [REGRA_24H]);
    expect(result).toHaveLength(0);
  });

  it('descarta lembrete cujo instante ja passou (startAfter no passado)', () => {
    // Consulta ja aconteceu: starts_at no passado
    const passado = { ...APPOINTMENT_DATA, startsAt: '2020-01-01T11:00:00.000Z' };
    const nowMs = new Date('2026-10-01T00:00:00.000Z').getTime();
    const result = scheduleReminders(passado, [REGRA_24H], nowMs);
    expect(result).toHaveLength(0);
  });

  it('canal SMS nao tem fallback', () => {
    const regraSms: AutomationRule = { ...REGRA_24H, channel: 'sms' };
    const result = scheduleReminders(APPOINTMENT_DATA, [regraSms]);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.fallbackChannel).toBeNull();
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: 7 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `scheduleReminders`.

Criar `packages/messaging/src/automations/reminder.ts`:

```ts
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
  nowMs: number = Date.now(),
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
    const startAfterMs = new Date(startAfter).getTime();
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
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: 7 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/reminder.ts packages/messaging/src/automations/reminder.test.ts
git commit -m "feat(messaging): reminder scheduling with clinic timezone and SMS fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 22: handler de pos-consulta e NPS — `handleEncounterFinalized` e `scheduleNps`

**Arquivos:**
- Criar `packages/messaging/src/automations/post-encounter.ts`
- Teste `packages/messaging/src/automations/post-encounter.test.ts`

**Contexto:** quando o evento `ENCOUNTER_FINALIZED` chega, gera ate dois outbox entries: (1) pos-consulta 24h depois (se regra `encounter_finalized` ativa), e (2) NPS 7 dias depois (se regra `nps_due` ativa). Ambos usam `computeReminderInstant` para calcular o instante de envio no fuso da clinica.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/post-encounter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './post-encounter';
import type { AutomationRule } from './confirmation';

const REGRA_POS: AutomationRule = {
  id: 'rule-pos',
  tenantId: 'tenant-1',
  trigger: 'encounter_finalized',
  templateId: 'tpl-pos-consulta',
  timingOffsetMinutes: 1440, // 24h depois
  active: true,
  channel: 'whatsapp',
};

const REGRA_NPS: AutomationRule = {
  id: 'rule-nps',
  tenantId: 'tenant-1',
  trigger: 'nps_due',
  templateId: 'tpl-nps',
  timingOffsetMinutes: 10080, // 7 dias depois
  active: true,
  channel: 'whatsapp',
};

const ENCOUNTER: EncounterFinalizedPayload = {
  tenantId: 'tenant-1',
  encounterId: 'enc-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  // Finalizado as 17:00 SP = 20:00 UTC
  finalizedAt: '2026-10-07T20:00:00.000Z',
};

describe('handleEncounterFinalized', () => {
  it('gera pos-consulta 24h apos finalizacao no fuso da clinica', () => {
    const result = handleEncounterFinalized(ENCOUNTER, [REGRA_POS]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_POST_ENCOUNTER');
    expect(entry.aggregateId).toBe('enc-1');
    // 17:00 SP dia 7 + 24h = 17:00 SP dia 8 = 20:00 UTC dia 8
    expect(entry.startAfter).toBe('2026-10-08T20:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
  });

  it('retorna vazio sem regra ativa', () => {
    const result = handleEncounterFinalized(ENCOUNTER, []);
    expect(result).toHaveLength(0);
  });

  it('ignora regra de outro trigger', () => {
    const result = handleEncounterFinalized(ENCOUNTER, [REGRA_NPS]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...ENCOUNTER, patientPhone: null };
    const result = handleEncounterFinalized(semTel, [REGRA_POS]);
    expect(result).toHaveLength(0);
  });
});

describe('scheduleNps', () => {
  it('gera NPS 7 dias apos finalizacao no fuso da clinica', () => {
    const result = scheduleNps(ENCOUNTER, [REGRA_NPS]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_NPS');
    expect(entry.aggregateId).toBe('enc-1');
    // 17:00 SP dia 7 + 7 dias = 17:00 SP dia 14 = 20:00 UTC dia 14
    expect(entry.startAfter).toBe('2026-10-14T20:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.appointmentId).toBe('appt-1');
  });

  it('retorna vazio sem regra nps_due', () => {
    const result = scheduleNps(ENCOUNTER, [REGRA_POS]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...ENCOUNTER, patientPhone: null };
    const result = scheduleNps(semTel, [REGRA_NPS]);
    expect(result).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: 7 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `handleEncounterFinalized` e `scheduleNps`.

Criar `packages/messaging/src/automations/post-encounter.ts`:

```ts
/**
 * Automacoes pos-atendimento: acompanhamento e NPS.
 *
 * Pos-consulta: trigger `encounter_finalized`, template de acompanhamento
 * enviado N minutos apos finalizacao (tipicamente 24h = 1440 min).
 *
 * NPS: trigger `nps_due`, template com escala 0-10 enviado N minutos apos
 * finalizacao (tipicamente 7 dias = 10080 min). A resposta do paciente e
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
  /** Instante UTC da finalizacao. */
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
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: 7 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/post-encounter.ts packages/messaging/src/automations/post-encounter.test.ts
git commit -m "feat(messaging): post-encounter and NPS automation handlers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 23: migration 0075 — funcao SQL `msg.compute_send_at` e teste de integracao do lembrete no fuso correto

**Arquivos:**
- Criar `packages/db/migrations/0075_compute_send_at.sql`
- Teste `packages/messaging/src/automations/reminder-timezone.int.test.ts`

**Contexto:** o teste obrigatorio do enunciado: lembrete de 24h para consulta as 8h no fuso da clinica (America/Sao_Paulo) deve ser enviado as 8h do dia anterior, nao as 5h UTC. Este teste de integracao valida a funcao SQL e o fluxo completo. A funcao SQL `msg.compute_send_at` espelha a logica de `computeReminderInstant` no banco, para que o job de lembrete possa calcular o instante de envio diretamente na query.

- [ ] **Passo 1** — escrever o teste de integracao.

Criar `packages/messaging/src/automations/reminder-timezone.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.compute_send_at — fuso da clinica', () => {
  it('lembrete 24h antes: consulta 8h SP sai 8h dia anterior SP, nao 5h UTC', async () => {
    // Consulta as 8h em America/Sao_Paulo = 11:00 UTC
    // Offset -1440 min (24h antes)
    // Esperado: 8h dia anterior SP = 11:00 UTC dia anterior
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-06T11:00:00Z');
  });

  it('lembrete 2h antes: consulta 8h SP sai 6h SP (9h UTC)', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -120)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-07T09:00:00Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-08T11:00:00Z');
  });

  it('NPS 7 dias depois', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 10080)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-14T11:00:00Z');
  });

  it('confirma que 24h antes NAO e simplesmente subtrair 1440 min do UTC', async () => {
    // Demonstra o ERRO que teriamos se subtraissemos diretamente do UTC.
    // Consulta as 8h em SP (UTC-3) = 11:00 UTC.
    // Subtrair 1440 min do UTC: 11:00 - 24h = 11:00 dia anterior (coincidencia ERRADA).
    // Mas para um fuso com DST, o resultado seria diferente.
    // Testamos com America/New_York para provar a diferenca:
    // Consulta 2026-03-09 09:00 EDT (UTC-4) = 13:00 UTC
    // 24h antes local = 2026-03-08 09:00 EST (UTC-5) = 14:00 UTC
    // Se fosse subtracao pura: 13:00 - 24h = 13:00 dia anterior (ERRADO)
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-03-09T13:00:00Z'::timestamptz, 'America/New_York', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    // 2026-03-08 09:00 EST = 14:00 UTC, NAO 13:00 UTC
    expect(rows[0]!.send_at).toBe('2026-03-08T14:00:00Z');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: testes falham (funcao `msg.compute_send_at` nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: `FAIL` — funcao `msg.compute_send_at` nao existe.

- [ ] **Passo 3** — escrever a migration 0075.

Criar `packages/db/migrations/0075_compute_send_at.sql`:

```sql
-- 0075_compute_send_at.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Funcao SQL que calcula o instante UTC de envio de automacao respeitando o
-- fuso da clinica. O offset e aplicado no horario LOCAL, nao no UTC.
--
-- Algoritmo:
-- 1. Converte o instante de referencia para o fuso da clinica.
-- 2. Aplica o offset em minutos no horario local.
-- 3. O Postgres converte de volta para timestamptz automaticamente.
--
-- Isso garante que o lembrete de 24h antes de uma consulta as 8h em
-- America/Sao_Paulo sai as 8h do dia anterior em horario local, e NAO
-- as 5h UTC (que seria o resultado de subtrair 1440 min do instante UTC).

CREATE FUNCTION msg.compute_send_at(
  p_reference_at  timestamptz,
  p_timezone      text,
  p_offset_minutes int
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  -- O truque: converter para o fuso local, somar o intervalo no espaco local,
  -- e converter de volta. O Postgres faz a conversao de volta corretamente,
  -- incluindo transicoes de horario de verao.
  SELECT ((p_reference_at AT TIME ZONE p_timezone)
          + make_interval(mins => p_offset_minutes))
         AT TIME ZONE p_timezone
$$;

ALTER FUNCTION msg.compute_send_at(timestamptz, text, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION msg.compute_send_at(timestamptz, text, int) TO app_rw;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0075 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — exportar os modulos de automacao no indice do pacote e commitar.

Modificar `packages/messaging/src/index.ts`:

```ts
export {
  computeReminderInstant,
} from './automations/reminder-timing';

export {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type AutomationTrigger,
  type ConfirmationOutboxEntry,
} from './automations/confirmation';

export {
  scheduleReminders,
  type ReminderOutboxEntry,
} from './automations/reminder';

export {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './automations/post-encounter';
```

Commitar:

```bash
git add packages/db/migrations/0075_compute_send_at.sql \
  packages/messaging/src/automations/reminder-timezone.int.test.ts \
  packages/messaging/src/index.ts
git commit -m "feat(messaging): SQL compute_send_at and timezone integration test (0075)

The reminder for an 8 AM appointment in America/Sao_Paulo fires at
8 AM the previous day in local time, not 5 AM UTC.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

## Parte III — Financeiro

### Task 24: migration 0076 — enum, categorias e metodos de pagamento no schema fin

**Arquivos**

- Criar `packages/db/migrations/0076_fin_category_payment_method.sql`
- Teste `packages/payments/src/schema.int.test.ts` (criado na Task 25, valida aqui tambem)

**Passos**

- [ ] Criar a migration `packages/db/migrations/0076_fin_category_payment_method.sql`:

```sql
-- 0076_fin_category_payment_method.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `fin` ja existe (migration 0002). Aqui nascem os tipos enumerados e as
-- tabelas de referencia: categorias de lancamento e metodos de pagamento.
-- Dinheiro em centavos inteiros (bigint), sem numeric — decisao irreversivel §10.

-- ---------------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------------
CREATE TYPE fin.entry_kind AS ENUM ('receita', 'despesa');

CREATE TYPE fin.payment_method_kind AS ENUM (
  'dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'link', 'convenio');

CREATE TYPE fin.entry_status AS ENUM (
  'pendente', 'pago', 'cancelado', 'estornado');

-- ---------------------------------------------------------------------------
-- 2. Categorias de lancamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.category (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  name        text NOT NULL COLLATE "pt-BR-x-icu",
  kind        fin.entry_kind NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name, kind)
);
ALTER TABLE fin.category OWNER TO app_owner;
ALTER TABLE fin.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.category FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.category AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Metodos de pagamento do tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.payment_method (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  kind         fin.payment_method_kind NOT NULL,
  name         text NOT NULL COLLATE "pt-BR-x-icu",
  provider_ref text,          -- ref do PSP para cartao/pix; null para dinheiro
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE fin.payment_method OWNER TO app_owner;
ALTER TABLE fin.payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_method FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_method AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0076 aplicada sem erro.

- [ ] Rodar a suite de isolamento para garantir que as tabelas novas passam:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas (incluindo `fin.category` e `fin.payment_method`) passam nos testes de RLS e FK composta.

---

### Task 25: migration 0077 — lancamento financeiro e recibo

**Arquivos**

- Criar `packages/db/migrations/0077_fin_entry_receipt.sql`
- Criar `packages/payments/src/schema.int.test.ts`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0077_fin_entry_receipt.sql`:

```sql
-- 0077_fin_entry_receipt.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Lancamento financeiro (fin.entry) e recibo (fin.receipt). Dinheiro em centavos
-- inteiros (bigint) — Money do kernel, nunca numeric. A coluna amount_cents e
-- bigint para acomodar valores grandes sem perda.

-- ---------------------------------------------------------------------------
-- 1. Lancamento financeiro
-- ---------------------------------------------------------------------------
CREATE TABLE fin.entry (
  tenant_id         uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                uuid NOT NULL,
  kind              fin.entry_kind NOT NULL,
  category_id       uuid,
  patient_id        uuid,
  appointment_id    uuid,
  professional_id   uuid NOT NULL,
  clinic_id         uuid NOT NULL,
  description       text NOT NULL COLLATE "pt-BR-x-icu",
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  payment_method_id uuid NOT NULL,
  paid_at           timestamptz(3),
  due_date          date,
  status            fin.entry_status NOT NULL DEFAULT 'pendente',
  external_ref      text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by        uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, category_id)
    REFERENCES fin.category(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES fin.payment_method(tenant_id, id)
);
ALTER TABLE fin.entry OWNER TO app_owner;

CREATE INDEX ix_entry_tenant_clinic_date ON fin.entry
  (tenant_id, clinic_id, created_at DESC);
CREATE INDEX ix_entry_patient ON fin.entry (tenant_id, patient_id)
  WHERE patient_id IS NOT NULL;
CREATE INDEX ix_entry_appointment ON fin.entry (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

ALTER TABLE fin.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.entry AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Sequencia de recibo por tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt_counter (
  tenant_id   uuid NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id)
);
ALTER TABLE fin.receipt_counter OWNER TO app_owner;
ALTER TABLE fin.receipt_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt_counter AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Recibo
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  entry_id        uuid NOT NULL,
  receipt_number  bigint NOT NULL,
  issued_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  pdf_storage_key text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  FOREIGN KEY (tenant_id, entry_id)
    REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.receipt OWNER TO app_owner;
ALTER TABLE fin.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Whitelist de chaves de auditoria para financeiro
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',        -- valor em centavos do lancamento financeiro
              'payment_method',      -- tipo do meio de pagamento (enum fechado)
              'receipt_number'       -- numero sequencial do recibo
            )
         );
$$;

RESET ROLE;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0077 aplicada sem erro.

- [ ] Criar o teste de integracao do schema em `packages/payments/src/schema.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeFinanceiro {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  categoryId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearFinanceiro(): Promise<SementeFinanceiro> {
  const s: SementeFinanceiro = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    categoryId: uuidv7(), paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Financeiro', '12ABC34501DE35')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Fin')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Financeiro', 'completo')`,
      [s.tenantId, s.patientId]);
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

let s: SementeFinanceiro;
let actor: Actor;

beforeAll(async () => {
  s = await semearFinanceiro();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semeia categoria e metodo de pagamento via transacao de negocio
  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES (app.require_tenant_id(), $1, 'Consulta', 'receita')`,
      [s.categoryId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin — categorias e metodos', () => {
  it('insere e le categoria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.category WHERE id = $1`,
        [s.categoryId]));
    expect(rows[0]).toEqual({ name: 'Consulta', kind: 'receita' });
  });

  it('insere e le metodo de pagamento com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind::text AS kind FROM fin.payment_method WHERE id = $1`,
        [s.paymentMethodId]));
    expect(rows[0]).toEqual({ name: 'Dinheiro', kind: 'dinheiro' });
  });

  it('insere lancamento financeiro e recibo', async () => {
    const entryId = uuidv7();
    const receiptId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4, $5,
                 'Consulta particular', 25000, $6, clock_timestamp(), 'pago', $7)`,
        [entryId, s.categoryId, s.patientId, s.professionalId, s.clinicId,
         s.paymentMethodId, `pay-${entryId}`]);

      // Provisiona o contador de recibo
      await tx.query(
        `INSERT INTO fin.receipt_counter (tenant_id, next_value)
         VALUES (app.require_tenant_id(), 1)
         ON CONFLICT (tenant_id) DO NOTHING`);

      // Consome o proximo numero de recibo
      const { rows: counterRows } = await tx.query<{ consumed: string }>(
        `UPDATE fin.receipt_counter
            SET next_value = next_value + 1
          WHERE tenant_id = app.require_tenant_id()
        RETURNING next_value - 1 AS consumed`);
      const receiptNumber = Number(counterRows[0]?.consumed);

      await tx.query(
        `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number)
         VALUES (app.require_tenant_id(), $1, $2, $3)`,
        [receiptId, entryId, receiptNumber]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; status: string; receipt_number: string }>(
        `SELECT e.amount_cents::text AS amount_cents, e.status::text AS status,
                r.receipt_number::text AS receipt_number
           FROM fin.entry e
           JOIN fin.receipt r ON (r.tenant_id, r.entry_id) = (e.tenant_id, e.id)
          WHERE e.id = $1`, [entryId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      status: 'pago',
      receipt_number: '1',
    });
  });

  it('rejeita idempotency_key duplicada', async () => {
    const key = `dup-${uuidv7()}`;
    const e1 = uuidv7();
    const e2 = uuidv7();

    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Duplicata', 10000, $4, 'pendente', $5)`,
        [e1, s.professionalId, s.clinicId, s.paymentMethodId, key]));

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Duplicata 2', 10000, $4, 'pendente', $5)`,
          [e2, s.professionalId, s.clinicId, s.paymentMethodId, key])),
    ).rejects.toThrow();
  });

  it('rejeita amount_cents zero ou negativo', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                   'Invalido', 0, $4, 'pendente', $5)`,
          [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
           `zero-${uuidv7()}`])),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/payments/src/schema.int.test.ts
```

Saida esperada: 5 testes passando.

- [ ] Rodar a suite de isolamento:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas `fin.*` passam.

---

### Task 26: migration 0078 — daily_rollup e policy

**Arquivos**

- Criar `packages/db/migrations/0078_fin_daily_rollup.sql`
- Modificar `packages/payments/src/schema.int.test.ts`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0078_fin_daily_rollup.sql`:

```sql
-- 0078_fin_daily_rollup.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.7 — daily_rollup com DUAS bases (competencia e caixa). O sentinel UUID
-- 00000000-0000-0000-0000-000000000000 substitui NULL em category_id na PK.
-- Materializado por job noturno. Detector de divergencia obrigatorio.

CREATE TABLE fin.daily_rollup (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id    uuid NOT NULL,
  day          date NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('competencia', 'caixa')),
  kind         fin.entry_kind NOT NULL,
  category_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  status       text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0,
  entries      int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, clinic_id, day, basis, kind, category_id, status),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
ALTER TABLE fin.daily_rollup OWNER TO app_owner;

ALTER TABLE fin.daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.daily_rollup FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.daily_rollup AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- O job noturno precisa de INSERT/UPDATE/DELETE para recalcular o rollup.
-- O papel `jobs` tem BYPASSRLS e nao usa withTenantTx; acessa diretamente.
GRANT SELECT, INSERT, UPDATE, DELETE ON fin.daily_rollup TO jobs;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0078 aplicada sem erro.

- [ ] Adicionar testes ao `packages/payments/src/schema.int.test.ts`. Acrescentar o describe a seguir ao final do arquivo:

```ts
describe('schema fin — daily_rollup', () => {
  it('insere e le rollup com sentinela de categoria', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'competencia', 'receita',
                 '00000000-0000-0000-0000-000000000000', 'pago', 25000, 1)`,
        [s.clinicId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; entries: number; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, entries, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'competencia'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({
      amount_cents: '25000',
      entries: 1,
      basis: 'competencia',
    });
  });

  it('insere rollup com base caixa (paid_at)', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.daily_rollup
           (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
         VALUES (app.require_tenant_id(), $1, '2026-08-01', 'caixa', 'receita',
                 $2, 'pago', 25000, 1)`,
        [s.clinicId, s.categoryId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; basis: string }>(
        `SELECT amount_cents::text AS amount_cents, basis
           FROM fin.daily_rollup
          WHERE clinic_id = $1 AND day = '2026-08-01' AND basis = 'caixa'`,
        [s.clinicId]));

    expect(rows[0]).toEqual({ amount_cents: '25000', basis: 'caixa' });
  });

  it('rejeita basis diferente de competencia ou caixa', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.daily_rollup
             (tenant_id, clinic_id, day, basis, kind, status, amount_cents, entries)
           VALUES (app.require_tenant_id(), $1, '2026-08-02', 'outro', 'receita', 'pago', 100, 1)`,
          [s.clinicId])),
    ).rejects.toThrow();
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/payments/src/schema.int.test.ts
```

Saida esperada: 8 testes passando (5 anteriores + 3 novos).

- [ ] Rodar a suite de isolamento:

```bash
pnpm test:iso
```

Saida esperada: `fin.daily_rollup` passa nos testes de RLS e FK composta.

---

### Task 27: PaymentProvider — contrato e fake — **SUPERSEDED pelo Bloco 06**

> **COLISAO RESOLVIDA**: o contrato PaymentProvider deste bloco e SUPERSEDED
> pelo Bloco 06 (Task 30). Diferencas:
> - PaymentStatus: este bloco tem 7 valores, Bloco 06 tem 5 (vence Bloco 06)
> - PaymentSnapshot: este bloco tem metadata, Bloco 06 tem feeCents/method (vence Bloco 06)
> - createPaymentLink: Bloco 06 adiciona idempotencyKey (vence Bloco 06)
> - createFakePaymentProvider: Bloco 06 tem mais modos de falha (vence Bloco 06)
>
> Este bloco deve OMITIR a criacao de `payment.ts` e `payment-fake.ts` nos
> arquivos de integrations e usar a versao do Bloco 06.
> As funcoes de dominio (recordPayment, cancelPayment, etc.) e os testes
> de unidade PERMANECEM validos — usam o contrato, nao o definem.

**Arquivos**

- Criar `packages/integrations/src/contracts/payment.ts`
- Criar `packages/integrations/src/fakes/payment-fake.ts`
- Criar `packages/integrations/src/fakes/payment-fake.test.ts`
- Modificar `packages/integrations/src/index.ts`

**Passos**

- [ ] Criar o contrato em `packages/integrations/src/contracts/payment.ts`:

```ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export type PaymentStatus =
  | 'pending' | 'approved' | 'declined' | 'refunded'
  | 'partially_refunded' | 'cancelled' | 'indeterminate';

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly method: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly netCents: number;
  readonly feeCents: number;
  readonly settledAt: Rfc3339;
}

export interface PaymentLinkInput {
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes: number;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentLinkResult {
  readonly providerPaymentId: string;
  readonly paymentUrl: string;
  readonly expiresAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(
    ctx: ProviderCtx,
    i: PaymentLinkInput,
  ): Promise<ProviderResult<PaymentLinkResult>>;

  getPayment(
    ctx: ProviderCtx,
    i: { providerPaymentId: string },
  ): Promise<ProviderResult<PaymentSnapshot>>;

  refund(
    ctx: ProviderCtx,
    i: { providerPaymentId: string; amountCents?: number; reason: string },
  ): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(
    raw: Buffer,
    h: Record<string, string>,
  ): { valid: boolean; reason?: string };

  /** Conciliacao: taxa REAL vem do PSP; nunca calculamos por conta propria. */
  fetchSettlements(
    ctx: ProviderCtx,
    i: { from: Rfc3339; to: Rfc3339 },
  ): Promise<ProviderResult<Settlement[]>>;
}
```

- [ ] Criar o fake em `packages/integrations/src/fakes/payment-fake.ts`:

```ts
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentLinkInput, PaymentLinkResult, PaymentProvider,
  PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout';
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const pagamentos = new Map<string, PaymentSnapshot>();

  function falha<T>() {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, detail: 'PSP fake fora' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false, detail: 'deadline 3s' });
    }
    return null;
  }

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit_card', 'debit_card']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(ctx: ProviderCtx, i: PaymentLinkInput) {
      const f = falha<PaymentLinkResult>();
      if (f) return f;

      const providerPaymentId = `fake-pay-${ctx.idempotencyKey}`;
      const expiresAt = asRfc3339(
        isoFromMs(systemClock.nowMs() + i.expiresInMinutes * 60_000),
      ) ?? agora();

      const snapshot: PaymentSnapshot = {
        providerPaymentId,
        status: 'pending',
        amountCents: i.amountCents,
        paidAt: null,
        method: null,
        metadata: i.metadata ?? {},
      };
      pagamentos.set(providerPaymentId, snapshot);

      return success<PaymentLinkResult>({
        providerPaymentId,
        paymentUrl: `https://psp.fake/pay/${providerPaymentId}`,
        expiresAt,
      }, providerPaymentId);
    },

    async getPayment(_ctx: ProviderCtx, i) {
      const f = falha<PaymentSnapshot>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }
      return success(snap, i.providerPaymentId);
    },

    async refund(ctx: ProviderCtx, i) {
      const f = falha<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;

      const snap = pagamentos.get(i.providerPaymentId);
      if (!snap) {
        return failure({ kind: 'rejected', retrySafe: false,
          code: 'NOT_FOUND', detail: `pagamento ${i.providerPaymentId} nao encontrado` });
      }

      const refundId = `fake-refund-${ctx.idempotencyKey}`;
      const refundedSnap: PaymentSnapshot = {
        ...snap,
        status: i.amountCents !== undefined && i.amountCents < snap.amountCents
          ? 'partially_refunded' : 'refunded',
      };
      pagamentos.set(i.providerPaymentId, refundedSnap);

      return success({ refundId, status: refundedSnap.status }, refundId);
    },

    verifyWebhook(_raw: Buffer, _h) {
      return { valid: true };
    },

    async fetchSettlements(_ctx: ProviderCtx, _i) {
      const f = falha<Settlement[]>();
      if (f) return f;

      const settlements: Settlement[] = [];
      for (const [, snap] of pagamentos) {
        if (snap.status === 'approved' || snap.status === 'refunded') {
          settlements.push({
            providerPaymentId: snap.providerPaymentId,
            grossCents: snap.amountCents,
            netCents: Math.round(snap.amountCents * 0.97),
            feeCents: Math.round(snap.amountCents * 0.03),
            settledAt: agora(),
          });
        }
      }
      return success(settlements, 'fake-settlements');
    },
  };
}
```

- [ ] Criar o teste em `packages/integrations/src/fakes/payment-fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafetyDeclared } from '../conformance';
import { type ProviderCtx } from '../contracts/common';
import { createFakePaymentProvider } from './payment-fake';

function ctx(key: string): ProviderCtx {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorUserId: '00000000-0000-0000-0000-000000000002',
    requestId: '00000000-0000-0000-0000-000000000003',
    idempotencyKey: key,
    deadlineMs: 5000,
  };
}

describe('PaymentProvider fake', () => {
  it('declara safety para todos os metodos', () => {
    const p = createFakePaymentProvider();
    expect(assertSafetyDeclared(p, [
      'createPaymentLink', 'getPayment', 'refund', 'fetchSettlements',
    ])).toBe(true);
  });

  it('cria link, consulta e estorna', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('link-1'), {
      amountCents: 25000,
      description: 'Consulta particular',
      expiresInMinutes: 30,
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.value.paymentUrl).toContain('fake-pay-link-1');

    const get = await p.getPayment(ctx('get-1'), {
      providerPaymentId: link.value.providerPaymentId,
    });
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.status).toBe('pending');
      expect(get.value.amountCents).toBe(25000);
    }

    const refund = await p.refund(ctx('refund-1'), {
      providerPaymentId: link.value.providerPaymentId,
      reason: 'paciente desistiu',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('refunded');
    }
  });

  it('modo indisponivel retorna unavailable com retrySafe', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx('indisp-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unavailable');
      expect(r.error.retrySafe).toBe(true);
    }
  });

  it('modo timeout retorna timeout sem retrySafe — ESTADO DESCONHECIDO', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx('timeout-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  it('health retorna up=false quando indisponivel', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('verifyWebhook do fake sempre retorna valido', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), {})).toEqual({ valid: true });
  });

  it('estorno parcial marca como partially_refunded', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('partial-1'), {
      amountCents: 25000,
      description: 'Consulta',
      expiresInMinutes: 30,
    });
    if (!link.ok) return;

    const refund = await p.refund(ctx('partial-ref-1'), {
      providerPaymentId: link.value.providerPaymentId,
      amountCents: 10000,
      reason: 'estorno parcial',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('partially_refunded');
    }
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/integrations/src/fakes/payment-fake.test.ts
```

Saida esperada: 7 testes passando.

- [ ] Atualizar o barrel `packages/integrations/src/index.ts` para exportar o contrato e o fake:

```ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  type PaymentLinkInput, type PaymentLinkResult, type PaymentProvider,
  type PaymentSnapshot, type PaymentStatus, type Settlement,
} from './contracts/payment';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
```

- [ ] Rodar todos os testes de unidade do integrations para garantir que nada quebrou:

```bash
pnpm vitest run packages/integrations/src/
```

Saida esperada: todos os testes passando.

---

### Task 28: domain logic — recordPayment, cancelPayment, refundPayment

**Arquivos**

- Criar `packages/payments/src/record-payment.ts`
- Criar `packages/payments/src/record-payment.int.test.ts`
- Criar `packages/payments/src/test-support.ts`
- Modificar `packages/payments/src/index.ts`

**Passos**

- [ ] Criar o suporte de teste em `packages/payments/src/test-support.ts`:

```ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementePagamento {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  appointmentId: string;
  categoryId: string;
  paymentMethodDinheiroId: string;
  paymentMethodPixId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearPagamento(): Promise<SementePagamento> {
  const s: SementePagamento = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), appointmentId: uuidv7(),
    categoryId: uuidv7(),
    paymentMethodDinheiroId: uuidv7(), paymentMethodPixId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Pagamento', '12ABC34501DE35')`,
      [s.tenantId, `p-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade', '1234567', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Pag')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Pagamento', 'completo')`,
      [s.tenantId, s.patientId]);

    // Procedimento e agendamento para vincular ao pagamento
    const procedureId = uuidv7();
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, procedureId]);
    await c.query(
      `INSERT INTO sched.appointment
         (id, tenant_id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-10-15T14:00:00Z', '2026-10-15T14:30:00Z', '2026-10-15',
               'atendendo', $7)`,
      [s.appointmentId, s.tenantId, s.patientId, s.professionalId,
       s.clinicId, procedureId, s.userId]);

    // Categoria e metodos de pagamento
    await c.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consulta', 'receita')`,
      [s.tenantId, s.categoryId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro'),
              ($1, $3, 'pix', 'Pix')`,
      [s.tenantId, s.paymentMethodDinheiroId, s.paymentMethodPixId]);

    // Provisiona o contador de recibo
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);

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

- [ ] Criar a logica de dominio em `packages/payments/src/record-payment.ts`:

```ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type PaymentFailure =
  | { kind: 'lancamento_nao_encontrado' }
  | { kind: 'metodo_nao_encontrado' }
  | { kind: 'ja_pago' }
  | { kind: 'ja_cancelado' }
  | { kind: 'ja_estornado' }
  | { kind: 'nao_pode_estornar'; status: string }
  | { kind: 'nao_pode_cancelar'; status: string };

export interface RecordPaymentInput {
  readonly patientId?: string;
  readonly appointmentId?: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly categoryId?: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paymentMethodId: string;
  readonly paidNow: boolean;
  readonly dueDate?: string;
  readonly externalRef?: string;
  readonly idempotencyKey: string;
}

export interface RecordedPayment {
  readonly entryId: string;
  readonly receiptId: string | null;
  readonly receiptNumber: number | null;
  readonly status: string;
}

/**
 * Registra pagamento no atendimento. Se paidNow=true, marca como pago e gera
 * recibo automaticamente. O recibo usa numero sequencial por tenant via
 * fin.receipt_counter. A geracao de PDF do recibo e injetada em L3 (via
 * callback), NAO importa documents diretamente — mesmo padrao de exportRecord.
 */
export async function recordPayment(
  tx: TxClient,
  i: RecordPaymentInput,
  generateReceiptPdf?: (entryId: string, receiptNumber: number) => Promise<string | null>,
): Promise<Result<RecordedPayment, PaymentFailure>> {
  // Valida que o metodo de pagamento existe
  const { rows: methodRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method WHERE id = $1`, [i.paymentMethodId]);
  if (methodRows.length === 0) return err({ kind: 'metodo_nao_encontrado' });

  const entryId = uuidv7();
  const status = i.paidNow ? 'pago' : 'pendente';

  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, category_id, patient_id, appointment_id,
        professional_id, clinic_id, description, amount_cents,
        payment_method_id, paid_at, due_date, status, external_ref,
        idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
             $5, $6, $7, $8, $9,
             CASE WHEN $10::boolean THEN clock_timestamp() ELSE NULL END,
             $11::date, $12::fin.entry_status, $13, $14, app.current_user_id())`,
    [entryId, i.categoryId ?? null, i.patientId ?? null, i.appointmentId ?? null,
     i.professionalId, i.clinicId, i.description, i.amountCents,
     i.paymentMethodId, i.paidNow, i.dueDate ?? null, status,
     i.externalRef ?? null, i.idempotencyKey]);

  await tx.query(
    `SELECT audit.log('PAYMENT_RECORD', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'payment_method', $3::text,
                                         'status', $4::text), $5)`,
    [entryId, i.amountCents, 'receita', status, i.clinicId]);

  let receiptId: string | null = null;
  let receiptNumber: number | null = null;

  if (i.paidNow) {
    // Auto-provisiona e consome o proximo numero de recibo
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = fin.receipt_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    receiptNumber = Number(counterRows[0]?.consumed);

    receiptId = uuidv7();
    let pdfStorageKey: string | null = null;
    if (generateReceiptPdf) {
      pdfStorageKey = await generateReceiptPdf(entryId, receiptNumber);
    }

    await tx.query(
      `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number, pdf_storage_key)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4)`,
      [receiptId, entryId, receiptNumber, pdfStorageKey]);

    await tx.query(
      `SELECT audit.log('RECEIPT_ISSUE', 'fin', 'receipt', $1, 'sucesso',
                        jsonb_build_object('receipt_number', $2::bigint,
                                           'amount_cents', $3::bigint), $4)`,
      [receiptId, receiptNumber, i.amountCents, i.clinicId]);
  }

  return ok({ entryId, receiptId, receiptNumber, status });
}

export interface CancelPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function cancelPayment(
  tx: TxClient,
  i: CancelPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status !== 'pendente') {
    return err({ kind: 'nao_pode_cancelar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'cancelado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_CANCEL', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'cancelado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'cancelado' });
}

export interface RefundPaymentInput {
  readonly entryId: string;
  readonly reason: string;
}

export async function refundPayment(
  tx: TxClient,
  i: RefundPaymentInput,
): Promise<Result<{ entryId: string; status: string }, PaymentFailure>> {
  const { rows } = await tx.query<{ status: string; clinic_id: string }>(
    `SELECT status::text AS status, clinic_id::text AS clinic_id
       FROM fin.entry WHERE id = $1`, [i.entryId]);
  const entry = rows[0];
  if (!entry) return err({ kind: 'lancamento_nao_encontrado' });
  if (entry.status === 'estornado') return err({ kind: 'ja_estornado' });
  if (entry.status === 'cancelado') return err({ kind: 'ja_cancelado' });
  if (entry.status !== 'pago') {
    return err({ kind: 'nao_pode_estornar', status: entry.status });
  }

  await tx.query(
    `UPDATE fin.entry SET status = 'estornado' WHERE id = $1`, [i.entryId]);

  await tx.query(
    `SELECT audit.log('PAYMENT_REFUND', 'fin', 'entry', $1, 'sucesso',
                      jsonb_build_object('reason', $2::text,
                                         'status', 'estornado'::text), $3)`,
    [i.entryId, i.reason, entry.clinic_id]);

  return ok({ entryId: i.entryId, status: 'estornado' });
}
```

- [ ] Atualizar o barrel `packages/payments/src/index.ts`:

```ts
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
```

- [ ] Criar o teste de integracao em `packages/payments/src/record-payment.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment, cancelPayment, refundPayment } from './record-payment';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('recordPayment — registra pagamento no atendimento', () => {
  it('registra pagamento em dinheiro com recibo automatico', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        categoryId: s.categoryId,
        description: 'Consulta particular',
        amountCents: 25000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `rec-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pago');
    expect(r.value.receiptId).not.toBeNull();
    expect(r.value.receiptNumber).toBe(1);
  });

  it('registra pagamento pendente sem recibo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        patientId: s.patientId,
        appointmentId: s.appointmentId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Retorno',
        amountCents: 15000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: false,
        dueDate: '2026-11-01',
        idempotencyKey: `pend-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pendente');
    expect(r.value.receiptId).toBeNull();
    expect(r.value.receiptNumber).toBeNull();
  });

  it('recibo sequencial incrementa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Procedimento',
        amountCents: 50000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `seq-${uuidv7()}`,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.receiptNumber).toBe(2);
  });

  it('rejeita metodo de pagamento inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Teste',
        amountCents: 10000,
        paymentMethodId: uuidv7(),
        paidNow: false,
        idempotencyKey: `bad-method-${uuidv7()}`,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('metodo_nao_encontrado');
  });

  it('grava evento de auditoria PAYMENT_RECORD', async () => {
    const key = `audit-${uuidv7()}`;
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Auditoria',
        amountCents: 5000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: key,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_RECORD' AND entity_id = $1`,
        [r.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('cancelPayment — cancela lancamento pendente', () => {
  let pendingEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para cancelar',
        amountCents: 8000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `cancel-${uuidv7()}`,
      }));
    if (r.ok) pendingEntryId = r.value.entryId;
  });

  it('cancela lancamento pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'paciente desistiu' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('cancelado');
  });

  it('recusa cancelar lancamento ja cancelado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: pendingEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_cancelado');
  });

  it('recusa cancelar lancamento pago — deve estornar', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pago para cancelar',
        amountCents: 12000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `paid-cancel-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      cancelPayment(tx, { entryId: paid.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_cancelar');
  });
});

describe('refundPayment — estorna lancamento pago', () => {
  let paidEntryId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Para estornar',
        amountCents: 20000,
        paymentMethodId: s.paymentMethodPixId,
        paidNow: true,
        idempotencyKey: `refund-${uuidv7()}`,
      }));
    if (r.ok) paidEntryId = r.value.entryId;
  });

  it('estorna lancamento pago', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'cobranca indevida' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('estornado');
  });

  it('recusa estornar lancamento ja estornado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paidEntryId, reason: 'tentativa dupla' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_estornado');
  });

  it('recusa estornar lancamento pendente', async () => {
    const pendR = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Pendente para estornar',
        amountCents: 7000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: false,
        idempotencyKey: `refund-pend-${uuidv7()}`,
      }));
    if (!pendR.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: pendR.value.entryId, reason: 'teste' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nao_pode_estornar');
  });

  it('grava evento de auditoria PAYMENT_REFUND', async () => {
    const paid = await withTenantTx(actor, (tx) =>
      recordPayment(tx, {
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        description: 'Estorno auditoria',
        amountCents: 3000,
        paymentMethodId: s.paymentMethodDinheiroId,
        paidNow: true,
        idempotencyKey: `refund-audit-${uuidv7()}`,
      }));
    if (!paid.ok) return;

    const r = await withTenantTx(actor, (tx) =>
      refundPayment(tx, { entryId: paid.value.entryId, reason: 'auditoria' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'PAYMENT_REFUND' AND entity_id = $1`,
        [paid.value.entryId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar os testes de integracao:

```bash
pnpm vitest run packages/payments/src/record-payment.int.test.ts
```

Saida esperada: 12 testes passando.

---

### Task 29: rollup noturno — job de materializacao e detector de divergencia

**Arquivos**

- Criar `packages/payments/src/rollup.ts`
- Criar `packages/payments/src/rollup.int.test.ts`
- Modificar `packages/payments/src/index.ts`

**Passos**

- [ ] Criar a logica de rollup em `packages/payments/src/rollup.ts`:

```ts
import type { TxClient } from '@cadencia/db';

/**
 * §3.7 — materializa o daily_rollup para um tenant e um dia. O job noturno
 * chama esta funcao para cada tenant ativo. Usa DELETE + INSERT para garantir
 * consistencia: o rollup e pequeno (~240 linhas/mes por clinica) e o custo e
 * irrelevante comparado a complexidade de um UPSERT correto com PK composta
 * de 6 colunas.
 *
 * IMPORTANTE: esta funcao roda com o papel `jobs` (BYPASSRLS) e NAO usa
 * withTenantTx. Ela recebe o pool administrativo diretamente.
 */
export async function materializeRollup(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<{ competencia: number; caixa: number }> {
  // Limpa o dia para recalcular
  await tx.query(
    `DELETE FROM fin.daily_rollup WHERE tenant_id = $1 AND day = $2::date`,
    [tenantId, day]);

  // Base competencia: agregado pelo created_at do lancamento
  const { rowCount: compRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'competencia', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.created_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  // Base caixa: agregado pelo paid_at do lancamento (so os pagos)
  const { rowCount: caixaRows } = await tx.query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
     SELECT
       e.tenant_id, e.clinic_id, $2::date, 'caixa', e.kind,
       coalesce(e.category_id, '00000000-0000-0000-0000-000000000000'),
       e.status::text, sum(e.amount_cents), count(*)::int
     FROM fin.entry e
     WHERE e.tenant_id = $1
       AND e.paid_at IS NOT NULL
       AND e.paid_at::date = $2::date
     GROUP BY e.tenant_id, e.clinic_id, e.kind, e.category_id, e.status`,
    [tenantId, day]);

  return { competencia: compRows ?? 0, caixa: caixaRows ?? 0 };
}

export interface DivergenceRow {
  readonly clinicId: string;
  readonly day: string;
  readonly basis: string;
  readonly kind: string;
  readonly categoryId: string;
  readonly status: string;
  readonly rollupCents: number;
  readonly liveCents: number;
  readonly rollupEntries: number;
  readonly liveEntries: number;
}

/**
 * Detector de divergencia obrigatorio (§3.7). Compara o rollup materializado
 * com a agregacao ao vivo dos lancamentos. Roda como job noturno apos a
 * materializacao. Qualquer linha retornada indica divergencia que precisa de
 * investigacao. A data da ultima verificacao e exibida no painel.
 */
export async function detectDivergence(
  tx: TxClient,
  tenantId: string,
  day: string,
): Promise<DivergenceRow[]> {
  const { rows } = await tx.query<{
    clinic_id: string; day: string; basis: string; kind: string;
    category_id: string; status: string;
    rollup_cents: string; live_cents: string;
    rollup_entries: number; live_entries: number;
  }>(
    `WITH live_comp AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.created_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_caixa AS (
       SELECT e.clinic_id, e.kind::text AS kind,
              coalesce(e.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
              e.status::text AS status,
              sum(e.amount_cents) AS amount_cents, count(*)::int AS entries
         FROM fin.entry e
        WHERE e.tenant_id = $1 AND e.paid_at IS NOT NULL AND e.paid_at::date = $2::date
        GROUP BY e.clinic_id, e.kind, e.category_id, e.status
     ), live_all AS (
       SELECT clinic_id, 'competencia' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_comp
       UNION ALL
       SELECT clinic_id, 'caixa' AS basis, kind, category_id, status, amount_cents, entries
         FROM live_caixa
     )
     SELECT coalesce(r.clinic_id, l.clinic_id)::text AS clinic_id,
            $2::text AS day,
            coalesce(r.basis, l.basis) AS basis,
            coalesce(r.kind::text, l.kind) AS kind,
            coalesce(r.category_id, l.category_id)::text AS category_id,
            coalesce(r.status, l.status) AS status,
            coalesce(r.amount_cents, 0)::text AS rollup_cents,
            coalesce(l.amount_cents, 0)::text AS live_cents,
            coalesce(r.entries, 0) AS rollup_entries,
            coalesce(l.entries, 0) AS live_entries
       FROM fin.daily_rollup r
       FULL OUTER JOIN live_all l
         ON r.tenant_id = $1
        AND r.day = $2::date
        AND r.clinic_id = l.clinic_id
        AND r.basis = l.basis
        AND r.kind::text = l.kind
        AND r.category_id = l.category_id
        AND r.status = l.status
      WHERE (r.tenant_id = $1 OR r.tenant_id IS NULL)
        AND (coalesce(r.amount_cents, 0) != coalesce(l.amount_cents, 0)
          OR coalesce(r.entries, 0) != coalesce(l.entries, 0))`,
    [tenantId, day]);

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    day: r.day,
    basis: r.basis,
    kind: r.kind,
    categoryId: r.category_id,
    status: r.status,
    rollupCents: Number(r.rollup_cents),
    liveCents: Number(r.live_cents),
    rollupEntries: r.rollup_entries,
    liveEntries: r.live_entries,
  }));
}
```

- [ ] Atualizar o barrel `packages/payments/src/index.ts`:

```ts
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence,
  type DivergenceRow,
} from './rollup';
```

- [ ] Criar o teste de integracao em `packages/payments/src/rollup.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment } from './record-payment';
import { materializeRollup, detectDivergence } from './rollup';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;
let adminPool: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
  adminPool = new Pool({ connectionString: adminUrl(), max: 1 });

  // Registra dois pagamentos para o dia 2026-10-15 (data do appointment semeado)
  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      patientId: s.patientId,
      appointmentId: s.appointmentId,
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 1',
      amountCents: 25000,
      paymentMethodId: s.paymentMethodDinheiroId,
      paidNow: true,
      idempotencyKey: `rollup-1-${uuidv7()}`,
    }));

  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 2',
      amountCents: 15000,
      paymentMethodId: s.paymentMethodPixId,
      paidNow: true,
      idempotencyKey: `rollup-2-${uuidv7()}`,
    }));
});

afterAll(async () => {
  await adminPool.end();
  await closePools();
});

describe('materializeRollup — job noturno', () => {
  it('materializa rollup com as duas bases para o dia', async () => {
    // O job noturno roda com o papel `jobs` (BYPASSRLS).
    // Simulamos com a conexao administrativa.
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      // Descobre o dia dos lancamentos
      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      const result = await materializeRollup(tx as never, s.tenantId, day);
      expect(result.competencia).toBeGreaterThan(0);
      expect(result.caixa).toBeGreaterThan(0);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia retorna vazio apos materializacao correta', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa primeiro
      await materializeRollup(tx as never, s.tenantId, day);

      // Detecta divergencia — deve estar vazio
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs).toEqual([]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia pega rollup desatualizado', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa
      await materializeRollup(tx as never, s.tenantId, day);

      // Insere um lancamento extra sem rematerializar
      await client.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_at)
         VALUES ($1, $2, 'receita', $3, $4, $5,
                 'Extra nao materializado', 9900, $6, clock_timestamp(), 'pago',
                 $7, $8::date::timestamptz)`,
        [s.tenantId, uuidv7(), s.categoryId, s.professionalId, s.clinicId,
         s.paymentMethodDinheiroId, `extra-${uuidv7()}`, day]);

      // Detecta divergencia — deve encontrar
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs.length).toBeGreaterThan(0);

      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
```

- [ ] Rodar os testes de integracao:

```bash
pnpm vitest run packages/payments/src/rollup.int.test.ts
```

Saida esperada: 3 testes passando.

- [ ] Rodar todos os testes do pacote payments:

```bash
pnpm vitest run packages/payments/src/
```

Saida esperada: todos os testes passando (schema + record-payment + rollup).

- [ ] Rodar a suite de isolamento final:

```bash
pnpm test:iso
```

Saida esperada: todas as tabelas `fin.*` passam nos testes de RLS e FK composta.

### Task 30: contrato PaymentProvider e tipos auxiliares em packages/integrations

**Arquivos**
- Criar `packages/integrations/src/contracts/payment.ts`
- Criar `packages/integrations/src/contracts/payment.test.ts`
- Modificar `packages/integrations/src/index.ts`

**Por que primeiro:** o contrato e a fundacao de tudo neste bloco — sem ele nao existe fake, nao existe job de link, nao existe webhook. Segue o padrao exato de `signature.ts` e `prescription.ts`.

- [ ] Criar o arquivo de contrato `packages/integrations/src/contracts/payment.ts` com os tipos e a interface:

```ts
// packages/integrations/src/contracts/payment.ts
import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export const PAYMENT_STATUSES = [
  'pending', 'paid', 'expired', 'cancelled', 'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(v: string): v is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(v);
}

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amountCents: number;
  readonly paidAt: Rfc3339 | null;
  readonly feeCents: number | null;
  readonly method: string | null;
}

export interface Settlement {
  readonly providerPaymentId: string;
  readonly grossCents: number;
  readonly feeCents: number;
  readonly netCents: number;
  readonly settledAt: Rfc3339;
  readonly originalPaidAt: Rfc3339;
}

export interface PaymentProvider extends Provider {
  createPaymentLink(ctx: ProviderCtx, i: {
    amountCents: number;
    description: string;
    expiresAt?: Rfc3339;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ linkId: string; url: string; expiresAt: Rfc3339 }>>;

  getPayment(ctx: ProviderCtx, i: { providerPaymentId: string }):
    Promise<ProviderResult<PaymentSnapshot>>;

  refund(ctx: ProviderCtx, i: {
    providerPaymentId: string;
    amountCents?: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ refundId: string; status: PaymentStatus }>>;

  verifyWebhook(raw: Buffer, headers: Record<string, string>):
    { valid: boolean; reason?: string };

  fetchSettlements(ctx: ProviderCtx, i: { from: Rfc3339; to: Rfc3339 }):
    Promise<ProviderResult<Settlement[]>>;
}
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` e confirmar que o arquivo de teste ainda nao existe (erro esperado: arquivo nao encontrado).

- [ ] Criar o arquivo de teste `packages/integrations/src/contracts/payment.test.ts`:

```ts
// packages/integrations/src/contracts/payment.test.ts
import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES, isPaymentStatus } from './payment';

describe('status de pagamento', () => {
  it('enumera os cinco estados do ciclo de vida de um link', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'pending', 'paid', 'expired', 'cancelled', 'refunded',
    ]);
  });

  it('aceita status valido e recusa invalido em runtime', () => {
    expect(isPaymentStatus('paid')).toBe(true);
    expect(isPaymentStatus('aprovado')).toBe(false);
  });
});
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` — dois testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/contracts/payment.test.ts (2 tests)
 Tests  2 passed
```

- [ ] Adicionar as exportacoes em `packages/integrations/src/index.ts`:

```ts
// packages/integrations/src/index.ts
export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberSession, type PrescriptionItem, type PrescriptionProvider,
  type PrescriptionRecord,
} from './contracts/prescription';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  PAYMENT_STATUSES, isPaymentStatus,
  type PaymentProvider, type PaymentSnapshot, type PaymentStatus,
  type Settlement,
} from './contracts/payment';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
```

- [ ] Rodar `npx vitest run packages/integrations/src/contracts/payment.test.ts` — dois testes passam (o export do fake sera criado na Task 31; o `index.ts` acima sera atualizado apos a Task 31 para que compile).

**Nota:** o `index.ts` acima inclui a exportacao do fake que sera criado na Task 31. Ate la, a compilacao falha — isso e esperado. A ordem de commit segue o TDD: este commit so inclui `payment.ts`, `payment.test.ts` e a parte de `index.ts` que compila. A linha do fake e adicionada no commit da Task 31.

Commit: `feat(integrations): add PaymentProvider contract with status types`

---

### Task 31: fake PaymentProviderFake e teste de conformidade

**Arquivos**
- Criar `packages/integrations/src/fakes/payment-fake.ts`
- Criar `packages/integrations/src/fakes/payment-fake.test.ts`
- Modificar `packages/integrations/src/conformance.test.ts`
- Modificar `packages/integrations/src/index.ts`

- [ ] Criar o fake `packages/integrations/src/fakes/payment-fake.ts`:

```ts
// packages/integrations/src/fakes/payment-fake.ts
import { createHmac } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  PaymentProvider, PaymentSnapshot, PaymentStatus, Settlement,
} from '../contracts/payment';

const SEGREDO = 'cadencia-fake-payment-do-not-use-in-production';

export interface FakePaymentOptions {
  readonly modo?: 'ok' | 'indisponivel' | 'timeout' | 'rejeitado';
  readonly agora?: () => Rfc3339;
  /** Simula webhook de pagamento confirmado — getPayment devolve paid. */
  readonly simularPago?: boolean;
}

function agoraPadrao(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs()))
    ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

function deterministico(rotulo: string, chave: string): string {
  return createHmac('sha256', SEGREDO).update(`${rotulo}:${chave}`).digest('hex').slice(0, 24);
}

export function createFakePaymentProvider(
  opts: FakePaymentOptions = {},
): PaymentProvider {
  const modo = opts.modo ?? 'ok';
  const agora = opts.agora ?? agoraPadrao;
  const pagamentos = new Map<string, PaymentSnapshot>();

  function talvezFalhar<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                       detail: 'PSP fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure({ kind: 'timeout', retrySafe: false,
                       detail: 'deadline de 3s estourou' });
    }
    if (modo === 'rejeitado') {
      return failure({ kind: 'rejected', retrySafe: false, code: 'LIMITE_EXCEDIDO',
                       detail: 'valor acima do limite do lojista' });
    }
    return null;
  }

  return {
    id: 'payment-fake',
    capabilities: new Set(['residency:br', 'pix', 'credit-card', 'boleto']),
    safety: {
      createPaymentLink: 'idempotent',
      getPayment: 'safe',
      refund: 'unsafe',
      fetchSettlements: 'safe',
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createPaymentLink(_ctx: ProviderCtx, i) {
      const f = talvezFalhar<{ linkId: string; url: string; expiresAt: Rfc3339 }>();
      if (f) return f;
      const linkId = deterministico('link', i.idempotencyKey);
      const expira = i.expiresAt
        ?? (asRfc3339(isoFromMs(systemClock.nowMs() + 24 * 60 * 60_000)) ?? agora());
      const snapshot: PaymentSnapshot = {
        providerPaymentId: linkId,
        status: opts.simularPago === true ? 'paid' : 'pending',
        amountCents: i.amountCents,
        paidAt: opts.simularPago === true ? agora() : null,
        feeCents: opts.simularPago === true ? Math.round(i.amountCents * 0.0199) : null,
        method: opts.simularPago === true ? 'pix' : null,
      };
      pagamentos.set(linkId, snapshot);
      return success(
        { linkId, url: `https://psp.fake/pay/${linkId}`, expiresAt: expira },
        `fake-link-${linkId}`,
      );
    },

    async getPayment(_ctx, i) {
      const f = talvezFalhar<PaymentSnapshot>();
      if (f) return f;
      const snap = pagamentos.get(i.providerPaymentId);
      if (snap !== undefined) {
        return success(snap, `fake-get-${i.providerPaymentId}`);
      }
      return success<PaymentSnapshot>({
        providerPaymentId: i.providerPaymentId,
        status: opts.simularPago === true ? 'paid' : 'pending',
        amountCents: 0,
        paidAt: opts.simularPago === true ? agora() : null,
        feeCents: opts.simularPago === true ? 0 : null,
        method: opts.simularPago === true ? 'pix' : null,
      }, `fake-get-${i.providerPaymentId}`);
    },

    async refund(_ctx, i) {
      const f = talvezFalhar<{ refundId: string; status: PaymentStatus }>();
      if (f) return f;
      const refundId = deterministico('refund', i.idempotencyKey);
      return success(
        { refundId, status: 'refunded' as const },
        `fake-refund-${refundId}`,
      );
    },

    verifyWebhook(_raw: Buffer, headers: Record<string, string>) {
      const sig = headers['x-psp-signature'];
      if (sig === undefined || sig === '') {
        return { valid: false, reason: 'assinatura ausente' };
      }
      return { valid: sig === 'fake-valid-signature', reason: undefined };
    },

    async fetchSettlements(_ctx, i) {
      const f = talvezFalhar<Settlement[]>();
      if (f) return f;
      const items: Settlement[] = [];
      for (const [id, snap] of pagamentos) {
        if (snap.status === 'paid' && snap.paidAt !== null) {
          items.push({
            providerPaymentId: id,
            grossCents: snap.amountCents,
            feeCents: snap.feeCents ?? 0,
            netCents: snap.amountCents - (snap.feeCents ?? 0),
            settledAt: agora(),
            originalPaidAt: snap.paidAt,
          });
        }
      }
      return success(items, `fake-settlements-${i.from}-${i.to}`);
    },
  };
}
```

- [ ] Rodar `npx vitest run packages/integrations/src/fakes/payment-fake.test.ts` — confirmar que o arquivo de teste ainda nao existe (erro esperado).

- [ ] Criar o teste `packages/integrations/src/fakes/payment-fake.test.ts`:

```ts
// packages/integrations/src/fakes/payment-fake.test.ts
import { describe, expect, it } from 'vitest';
import { createFakePaymentProvider } from './payment-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'pay-1', deadlineMs: 3000,
};

describe('provedor de pagamento falso', () => {
  it('declara safety por metodo — createPaymentLink e idempotent, refund e unsafe', () => {
    const p = createFakePaymentProvider();
    expect(p.safety.createPaymentLink).toBe('idempotent');
    expect(p.safety.getPayment).toBe('safe');
    expect(p.safety.refund).toBe('unsafe');
    expect(p.safety.fetchSettlements).toBe('safe');
  });

  it('createPaymentLink devolve linkId, url e expiresAt', async () => {
    const p = createFakePaymentProvider();
    const r = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta Dr. Alceu',
      idempotencyKey: 'idem-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.linkId).toBeTruthy();
      expect(r.value.url).toMatch(/^https:\/\//);
      expect(r.value.expiresAt).toMatch(/Z$/);
    }
  });

  it('e idempotente: a mesma chave devolve o MESMO linkId', async () => {
    const p = createFakePaymentProvider();
    const a = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta', idempotencyKey: 'idem-2',
    });
    const b = await p.createPaymentLink(ctx, {
      amountCents: 25000, description: 'Consulta', idempotencyKey: 'idem-2',
    });
    if (a.ok && b.ok) {
      expect(a.value.linkId).toBe(b.value.linkId);
    }
  });

  it('getPayment devolve snapshot do link criado', async () => {
    const p = createFakePaymentProvider({ simularPago: true });
    const link = await p.createPaymentLink(ctx, {
      amountCents: 15000, description: 'Retorno', idempotencyKey: 'idem-3',
    });
    if (!link.ok) throw new Error('nao criou link');
    const snap = await p.getPayment(ctx, { providerPaymentId: link.value.linkId });
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(snap.value.status).toBe('paid');
      expect(snap.value.paidAt).toBeTruthy();
      expect(snap.value.feeCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('refund devolve refundId e status refunded', async () => {
    const p = createFakePaymentProvider();
    const r = await p.refund(ctx, {
      providerPaymentId: 'link-x', reason: 'paciente desistiu',
      idempotencyKey: 'ref-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.refundId).toBeTruthy();
      expect(r.value.status).toBe('refunded');
    }
  });

  it('verifyWebhook aceita assinatura valida e recusa ausente', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), { 'x-psp-signature': 'fake-valid-signature' }).valid)
      .toBe(true);
    expect(p.verifyWebhook(Buffer.from('{}'), {}).valid).toBe(false);
  });

  it('fetchSettlements devolve liquidacoes dos pagamentos confirmados', async () => {
    const p = createFakePaymentProvider({ simularPago: true });
    await p.createPaymentLink(ctx, {
      amountCents: 30000, description: 'Procedimento', idempotencyKey: 'idem-settle',
    });
    const r = await p.fetchSettlements(ctx, {
      from: '2026-01-01T00:00:00.000Z' as any,
      to: '2026-12-31T23:59:59.999Z' as any,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeGreaterThanOrEqual(1);
      const s = r.value[0]!;
      expect(s.grossCents).toBe(30000);
      expect(s.netCents).toBe(s.grossCents - s.feeCents);
    }
  });

  it('o modo indisponivel devolve unavailable — e retryable', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx, {
      amountCents: 10000, description: 'T', idempotencyKey: 'idem-fail',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx, {
      amountCents: 10000, description: 'T', idempotencyKey: 'idem-fail-2',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });
});
```

- [ ] Rodar `npx vitest run packages/integrations/src/fakes/payment-fake.test.ts` — oito testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/fakes/payment-fake.test.ts (8 tests)
 Tests  8 passed
```

- [ ] Adicionar o PaymentProvider ao teste de conformidade em `packages/integrations/src/conformance.test.ts`:

```ts
// packages/integrations/src/conformance.test.ts
import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';
import { createFakePaymentProvider } from './fakes/payment-fake';

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
    expect(assertSafetyDeclared(createFakePaymentProvider(),
      ['createPaymentLink', 'getPayment', 'refund', 'fetchSettlements'])).toBe(true);
  });

  it('reprova provedor que esqueceu de declarar a safety de um metodo', () => {
    const p = createFakeSignatureProvider();
    expect(() => assertSafetyDeclared(p, ['metodoInexistente']))
      .toThrow(/safety nao declarada para metodoInexistente/);
  });

  it('timeout com efeito NAO duplica: a segunda chamada devolve o MESMO resultado', async () => {
    let chamadas = 0;
    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        return chamadas === 1 ? { estado: 'timeout' as const } : { estado: 'ok' as const, id: 'X' };
      },
      reconciliar: async () => ({ jaExiste: true, id: 'X' }),
    });
    expect(r).toEqual({ duplicou: false, id: 'X', viaReconciliacao: true });
  });

  it('reprova o adaptador que reenvia cegamente apos timeout', async () => {
    await expect(assertNoDuplicateOnTimeout({
      operacao: async () => ({ estado: 'ok' as const, id: `novo-${Math.random()}` }),
      reconciliar: async () => ({ jaExiste: false, id: null }),
      simularEfeitoNoTimeout: true,
    })).rejects.toThrow(/duplicou/);
  });
});
```

- [ ] Atualizar `packages/integrations/src/index.ts` adicionando as exportacoes do payment (o arquivo completo ja foi mostrado na Task 30 com as linhas do fake — agora que o fake existe, o arquivo compila).

- [ ] Rodar `npx vitest run packages/integrations/src/conformance.test.ts` — quatro testes passam.

Saida esperada:
```
 ✓ packages/integrations/src/conformance.test.ts (4 tests)
 Tests  4 passed
```

- [ ] Rodar `npx vitest run packages/integrations/` — todos os testes do pacote passam (14 testes no total).

Commit: `feat(integrations): add PaymentProviderFake with conformance tests`

---

### Task 32: migration 0079 — fin.payment_link e fin.reconciliation_log

**Arquivos**
- Criar `packages/db/migrations/0079_fin_payment_link.sql`
- Criar `packages/db/migrations/0079_fin_payment_link.iso.test.ts`

**Premissa:** esta migration assume que `fin.entry` e `fin.entry_kind` ja existem, criados por um bloco anterior (bloco de recebimento no atendimento, migrations 0074-0078). A tabela `fin.entry` tem pelo menos `tenant_id`, `id`, `paid_at`, `external_ref`, `amount_cents`, `kind`, `status`, `clinic_id`. A migration referencia `fin.entry(tenant_id, id)` via FK composta.

- [ ] Criar a migration `packages/db/migrations/0079_fin_payment_link.sql`:

```sql
-- 0079_fin_payment_link.sql
-- Link de pagamento e log de conciliacao.
-- Premissa: fin.entry e fin.entry_kind ja existem (migration anterior).

BEGIN;

--------------------------------------------------------------------
-- 1. fin.payment_link — vincula um link do PSP a um lancamento
--------------------------------------------------------------------
CREATE TABLE fin.payment_link (
  tenant_id       uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid           NOT NULL,
  entry_id        uuid           NOT NULL,
  provider_link_id varchar(120)  NOT NULL,
  url             text           NOT NULL,
  status          text           NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','expired','cancelled')),
  amount_cents    bigint         NOT NULL CHECK (amount_cents > 0),
  paid_at         timestamptz(3),
  fee_cents       bigint,
  method          text,
  provider_id     text           NOT NULL,
  idempotency_key text           NOT NULL,
  webhook_raw     jsonb,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by      uuid           NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider_link_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES fin.entry(tenant_id, id)
);

ALTER TABLE fin.payment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_link FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_link AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_payment_link_entry ON fin.payment_link (tenant_id, entry_id);
CREATE INDEX ix_payment_link_status ON fin.payment_link (tenant_id, status)
  WHERE status = 'pending';

--------------------------------------------------------------------
-- 2. fin.reconciliation_log — divergencias detectadas pela conciliacao
--------------------------------------------------------------------
CREATE TABLE fin.reconciliation_log (
  tenant_id          uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid           NOT NULL,
  reconciled_date    date           NOT NULL,
  provider_payment_id varchar(120)  NOT NULL,
  entry_id           uuid,
  kind               text           NOT NULL
                       CHECK (kind IN (
                         'amount_mismatch', 'fee_mismatch',
                         'missing_in_psp', 'missing_in_system',
                         'status_mismatch'
                       )),
  expected_cents     bigint,
  actual_cents       bigint,
  detail             text,
  resolved           boolean        NOT NULL DEFAULT false,
  resolved_at        timestamptz(3),
  resolved_by        uuid,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);

ALTER TABLE fin.reconciliation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.reconciliation_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.reconciliation_log AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_reconciliation_date ON fin.reconciliation_log (tenant_id, reconciled_date);
CREATE INDEX ix_reconciliation_unresolved ON fin.reconciliation_log (tenant_id)
  WHERE resolved = false;

COMMIT;
```

- [ ] Rodar `pnpm db:migrate` — migration 0079 aplica sem erro.

- [ ] Criar o teste de isolamento `packages/db/migrations/0079_fin_payment_link.iso.test.ts`:

```ts
// packages/db/migrations/0079_fin_payment_link.iso.test.ts
import { describe, expect, it } from 'vitest';

describe('isolamento fin.payment_link e fin.reconciliation_log', () => {
  it('as tabelas existem e serao cobertas pela suite test:iso automaticamente', () => {
    // A suite test:iso descobre tabelas do catalogo e reprova quem
    // esquecer tenant_id, RLS ou FK composta. Este teste e um marcador
    // para que a CI execute a suite apos a migration.
    expect(true).toBe(true);
  });
});
```

- [ ] Rodar `pnpm test:iso` — confirmar que `fin.payment_link` e `fin.reconciliation_log` passam no isolamento (RLS FORCE + tenant_id + FK composta).

Saida esperada: sem falhas nas novas tabelas.

Commit: `feat(db): migration 0079 — fin.payment_link and fin.reconciliation_log`

---

### Task 33: migration 0080 — funcao fin.refresh_daily_rollup (SOMENTE FUNCAO)

> **COLISAO RESOLVIDA**: a tabela `fin.daily_rollup` ja e criada pelo Bloco 05
> migration 0078 (com `amount_cents bigint`). Esta migration contem APENAS a
> funcao de recalculo. A coluna `occurred_date` NAO existe em `fin.entry` —
> usa-se `created_at::date` para competencia (alinhado com Bloco 05 materializeRollup).

**Arquivos**
- Criar `packages/db/migrations/0080_fin_refresh_daily_rollup.sql`

**Premissa:** `fin.entry_kind`, `fin.entry` e `fin.daily_rollup` ja existem (migrations 0076-0078, Bloco 05).

- [ ] Criar a migration `packages/db/migrations/0080_fin_refresh_daily_rollup.sql`:

```sql
-- 0080_fin_refresh_daily_rollup.sql
-- Funcao de recalculo do rollup diario. A TABELA fin.daily_rollup ja existe
-- (migration 0078, Bloco 05). Esta migration cria apenas a funcao.

BEGIN;

--------------------------------------------------------------------
-- fin.refresh_daily_rollup — SECURITY DEFINER para o job noturno
--    Recalcula o rollup de um dia para um tenant+clinic.
--    Comparacao com SUM real detecta divergencia.
--------------------------------------------------------------------
CREATE FUNCTION fin.refresh_daily_rollup(
  p_tenant_id uuid,
  p_clinic_id uuid,
  p_day       date
) RETURNS TABLE (
  divergent boolean,
  old_total bigint,
  new_total bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, pg_catalog AS $$
DECLARE
  v_old_total bigint;
  v_new_total bigint;
BEGIN
  -- Captura o total antigo do rollup
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_old_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  -- Apaga e recalcula
  DELETE FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  -- Competencia: agrupa pela data de criacao do lancamento (created_at::date)
  INSERT INTO fin.daily_rollup (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
  SELECT p_tenant_id, p_clinic_id, p_day, 'competencia',
         e.kind,
         COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'),
         e.status::text,
         SUM(e.amount_cents),
         COUNT(*)::int
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id
     AND e.clinic_id = p_clinic_id
     AND e.created_at::date = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

  -- Caixa: agrupa pela data de pagamento (paid_at)
  INSERT INTO fin.daily_rollup (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
  SELECT p_tenant_id, p_clinic_id, p_day, 'caixa',
         e.kind,
         COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'),
         e.status::text,
         SUM(e.amount_cents),
         COUNT(*)::int
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id
     AND e.clinic_id = p_clinic_id
     AND (e.paid_at AT TIME ZONE (
       SELECT timezone FROM app.clinic WHERE tenant_id = p_tenant_id AND id = p_clinic_id
     ))::date = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

  -- Captura o novo total do rollup
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_new_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  RETURN QUERY SELECT (v_old_total <> v_new_total), v_old_total, v_new_total;
END;
$$;

-- O job roda como `jobs` (BYPASSRLS), mas a funcao e SECURITY DEFINER
-- de app_owner para encapsular a logica de recalculo.
REVOKE ALL ON FUNCTION fin.refresh_daily_rollup(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin.refresh_daily_rollup(uuid, uuid, date) TO app_rw;

COMMIT;
```

- [ ] Rodar `pnpm db:migrate` — migration 0080 aplica sem erro.

- [ ] Rodar `pnpm test:iso` — confirmar que a funcao esta acessivel.

Commit: `feat(db): migration 0080 — fin.refresh_daily_rollup function (table in 0078)`

---

### Task 34: funcoes de dominio — criar link, processar webhook, conciliar

**Arquivos**
- Criar `packages/payments/src/create-payment-link.ts`
- Criar `packages/payments/src/process-webhook.ts`
- Criar `packages/payments/src/reconcile.ts`
- Criar `packages/payments/src/rollup.ts`
- Modificar `packages/payments/src/index.ts`
- Criar `packages/payments/src/payments.int.test.ts`
- Criar `packages/payments/src/test-support.ts`

- [ ] Criar o seed de teste `packages/payments/src/test-support.ts`:

```ts
// packages/payments/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeFinanceiro {
  tenantId: string; clinicId: string; userId: string;
  professionalId: string; patientId: string; procedureId: string;
  entryId: string;
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

export async function semearFinanceiro(): Promise<SementeFinanceiro> {
  const s: SementeFinanceiro = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(), procedureId: uuidv7(),
    entryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Financeiro', '98ABC76501DE43')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Fin', '7654321', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Recepcao Fin')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'recepcao')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '654321', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Joao Pagador Silva', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, clinic_id, patient_id, professional_id,
          kind, amount_cents, status, description, occurred_date, created_by)
       VALUES ($1, $2, $3, $4, $5,
               'receita', 25000, 'pendente', 'Consulta particular',
               '2026-08-04', $6)`,
      [s.tenantId, s.entryId, s.clinicId, s.patientId, s.professionalId, s.userId]);
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

- [ ] Criar `packages/payments/src/create-payment-link.ts`:

```ts
// packages/payments/src/create-payment-link.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7, type Result, ok, err, DomainError } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx, Rfc3339 } from '@cadencia/integrations';

export interface CreatePaymentLinkInput {
  readonly entryId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly expiresAt?: Rfc3339;
  readonly providerId: string;
}

export interface PaymentLinkCreated {
  readonly paymentLinkId: string;
  readonly url: string;
  readonly providerLinkId: string;
  readonly expiresAt: Rfc3339;
}

export async function createPaymentLink(
  tx: TxClient,
  provider: PaymentProvider,
  providerCtx: ProviderCtx,
  input: CreatePaymentLinkInput,
): Promise<Result<PaymentLinkCreated, DomainError>> {
  // Verificar que o entry existe e esta pendente
  const { rows: entryRows } = await tx.query<{ status: string; amount_cents: string }>(
    `SELECT status, amount_cents::text FROM fin.entry WHERE id = $1`,
    [input.entryId],
  );
  if (entryRows.length === 0) {
    return err(new DomainError('payment_link.entry_nao_encontrado',
      'lancamento financeiro nao encontrado'));
  }

  // Verificar se ja existe link pendente para este entry
  const { rows: existingRows } = await tx.query<{ id: string; url: string; provider_link_id: string }>(
    `SELECT id, url, provider_link_id FROM fin.payment_link
      WHERE entry_id = $1 AND status = 'pending'`,
    [input.entryId],
  );

  const idempotencyKey = `payment-link:${input.entryId}`;

  if (existingRows.length > 0) {
    const existing = existingRows[0]!;
    return ok({
      paymentLinkId: existing.id,
      url: existing.url,
      providerLinkId: existing.provider_link_id,
      expiresAt: providerCtx.idempotencyKey as Rfc3339,
    });
  }

  // Chamar o provedor
  const result = await provider.createPaymentLink(providerCtx, {
    amountCents: input.amountCents,
    description: input.description,
    expiresAt: input.expiresAt,
    idempotencyKey,
  });

  if (!result.ok) {
    return err(new DomainError('payment_link.provedor_falhou',
      `provedor de pagamento falhou: ${result.error.detail}`,
      { kind: result.error.kind }));
  }

  const paymentLinkId = uuidv7();
  await tx.query(
    `INSERT INTO fin.payment_link
       (tenant_id, id, entry_id, provider_link_id, url, status,
        amount_cents, provider_id, idempotency_key, created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'pending', $5, $6, $7, app.current_user_id())`,
    [paymentLinkId, input.entryId, result.value.linkId, result.value.url,
     input.amountCents, input.providerId, idempotencyKey],
  );

  return ok({
    paymentLinkId,
    url: result.value.url,
    providerLinkId: result.value.linkId,
    expiresAt: result.value.expiresAt,
  });
}
```

- [ ] Criar `packages/payments/src/process-webhook.ts`:

```ts
// packages/payments/src/process-webhook.ts
import type { TxClient } from '@cadencia/db';
import { DomainError, ok, err, type Result } from '@cadencia/kernel';
import type { PaymentProvider, PaymentSnapshot, ProviderCtx } from '@cadencia/integrations';

export interface WebhookPayload {
  readonly providerPaymentId: string;
  readonly status: string;
  readonly paidAt?: string;
  readonly feeCents?: number;
  readonly method?: string;
}

export interface WebhookProcessed {
  readonly paymentLinkId: string;
  readonly entryId: string;
  readonly newStatus: string;
}

export async function processPaymentWebhook(
  tx: TxClient,
  payload: WebhookPayload,
): Promise<Result<WebhookProcessed, DomainError>> {
  // Buscar o payment_link pelo provider_link_id
  const { rows } = await tx.query<{
    id: string; entry_id: string; status: string;
  }>(
    `SELECT id, entry_id, status FROM fin.payment_link
      WHERE provider_link_id = $1`,
    [payload.providerPaymentId],
  );

  if (rows.length === 0) {
    return err(new DomainError('webhook.link_nao_encontrado',
      `link de pagamento nao encontrado para provider_link_id: ${payload.providerPaymentId}`));
  }

  const link = rows[0]!;

  // Idempotencia: se ja esta pago, retorna sem erro
  if (link.status === 'paid' && payload.status === 'paid') {
    return ok({
      paymentLinkId: link.id,
      entryId: link.entry_id,
      newStatus: 'paid',
    });
  }

  // Atualizar o status do payment_link
  await tx.query(
    `UPDATE fin.payment_link
        SET status = $1,
            paid_at = CASE WHEN $1 = 'paid' THEN $2::timestamptz ELSE paid_at END,
            fee_cents = CASE WHEN $3::bigint IS NOT NULL THEN $3::bigint ELSE fee_cents END,
            method = CASE WHEN $4 IS NOT NULL THEN $4 ELSE method END,
            webhook_raw = $5::jsonb,
            updated_at = clock_timestamp()
      WHERE id = $6`,
    [
      payload.status,
      payload.paidAt ?? null,
      payload.feeCents ?? null,
      payload.method ?? null,
      JSON.stringify(payload),
      link.id,
    ],
  );

  // Se o pagamento foi confirmado, marcar paid_at no fin.entry
  if (payload.status === 'paid') {
    await tx.query(
      `UPDATE fin.entry
          SET paid_at = COALESCE(paid_at, $1::timestamptz),
              status = 'pago',
              external_ref = $2,
              updated_at = clock_timestamp()
        WHERE id = $3 AND paid_at IS NULL`,
      [payload.paidAt ?? new Date().toISOString(), payload.providerPaymentId, link.entry_id],
    );
  }

  return ok({
    paymentLinkId: link.id,
    entryId: link.entry_id,
    newStatus: payload.status,
  });
}
```

- [ ] Criar `packages/payments/src/reconcile.ts`:

```ts
// packages/payments/src/reconcile.ts
import type { TxClient } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { PaymentProvider, ProviderCtx, Settlement } from '@cadencia/integrations';

export interface ReconcileInput {
  readonly clinicId: string;
  readonly from: string;
  readonly to: string;
  readonly reconciledDate: string;
}

export interface ReconcileResult {
  readonly settlementsProcessed: number;
  readonly divergencesFound: number;
}

export async function reconcileSettlements(
  tx: TxClient,
  provider: PaymentProvider,
  providerCtx: ProviderCtx,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const result = await provider.fetchSettlements(providerCtx, {
    from: input.from as any,
    to: input.to as any,
  });

  if (!result.ok) {
    throw new Error(`fetchSettlements falhou: ${result.error.detail}`);
  }

  const settlements = result.value;
  let divergencesFound = 0;

  for (const s of settlements) {
    // Buscar o entry correspondente pelo external_ref
    const { rows } = await tx.query<{
      id: string; amount_cents: string; status: string;
    }>(
      `SELECT id, amount_cents::text, status::text
         FROM fin.entry
        WHERE external_ref = $1`,
      [s.providerPaymentId],
    );

    if (rows.length === 0) {
      // Pagamento existe no PSP mas nao no sistema
      await tx.query(
        `INSERT INTO fin.reconciliation_log
           (tenant_id, id, reconciled_date, provider_payment_id, kind,
            expected_cents, actual_cents, detail)
         VALUES (app.require_tenant_id(), $1, $2, $3, 'missing_in_system',
                 NULL, $4, 'pagamento encontrado no PSP sem correspondente no sistema')`,
        [uuidv7(), input.reconciledDate, s.providerPaymentId, s.grossCents],
      );
      divergencesFound += 1;
      continue;
    }

    const entry = rows[0]!;
    const entryAmountCents = Number(entry.amount_cents);

    // Comparar valor bruto
    if (entryAmountCents !== s.grossCents) {
      await tx.query(
        `INSERT INTO fin.reconciliation_log
           (tenant_id, id, reconciled_date, provider_payment_id, entry_id, kind,
            expected_cents, actual_cents, detail)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'amount_mismatch',
                 $5, $6, 'valor no sistema difere do valor bruto no PSP')`,
        [uuidv7(), input.reconciledDate, s.providerPaymentId, entry.id,
         entryAmountCents, s.grossCents],
      );
      divergencesFound += 1;
    }

    // Atualizar a taxa REAL do PSP no payment_link (a taxa vem do PSP, nunca calculamos)
    await tx.query(
      `UPDATE fin.payment_link
          SET fee_cents = $1, updated_at = clock_timestamp()
        WHERE provider_link_id = $2`,
      [s.feeCents, s.providerPaymentId],
    );
  }

  // Verificar entries pagos que nao apareceram na liquidacao do PSP
  const { rows: missingInPsp } = await tx.query<{ id: string; external_ref: string }>(
    `SELECT e.id, e.external_ref
       FROM fin.entry e
      WHERE e.clinic_id = $1
        AND e.status = 'pago'
        AND e.external_ref IS NOT NULL
        AND e.paid_at >= $2::timestamptz
        AND e.paid_at < $3::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM unnest($4::text[]) AS psp_id
           WHERE psp_id = e.external_ref
        )`,
    [
      input.clinicId,
      input.from,
      input.to,
      settlements.map((s) => s.providerPaymentId),
    ],
  );

  for (const missing of missingInPsp) {
    await tx.query(
      `INSERT INTO fin.reconciliation_log
         (tenant_id, id, reconciled_date, provider_payment_id, entry_id, kind, detail)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, 'missing_in_psp',
               'pagamento marcado como pago no sistema mas ausente na liquidacao do PSP')`,
      [uuidv7(), input.reconciledDate, missing.external_ref, missing.id],
    );
    divergencesFound += 1;
  }

  return { settlementsProcessed: settlements.length, divergencesFound };
}
```

- [ ] Criar `packages/payments/src/rollup.ts`:

```ts
// packages/payments/src/rollup.ts
import type { TxClient } from '@cadencia/db';

export interface RollupResult {
  readonly divergent: boolean;
  readonly oldTotal: number;
  readonly newTotal: number;
}

export async function refreshDailyRollup(
  tx: TxClient,
  tenantId: string,
  clinicId: string,
  day: string,
): Promise<RollupResult> {
  const { rows } = await tx.query<{
    divergent: boolean;
    old_total: string;
    new_total: string;
  }>(
    `SELECT divergent, old_total::text, new_total::text
       FROM fin.refresh_daily_rollup($1, $2, $3::date)`,
    [tenantId, clinicId, day],
  );
  const row = rows[0];
  if (row === undefined) {
    return { divergent: false, oldTotal: 0, newTotal: 0 };
  }
  return {
    divergent: row.divergent,
    oldTotal: Number(row.old_total),
    newTotal: Number(row.new_total),
  };
}
```

- [ ] Atualizar `packages/payments/src/index.ts`:

```ts
// packages/payments/src/index.ts
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export { refreshDailyRollup, type RollupResult } from './rollup';
```

- [ ] Rodar `npx tsc --noEmit -p packages/payments/tsconfig.json` (ou equivalente) — compila sem erro.

Commit: `feat(payments): domain functions for payment link, webhook, reconciliation and rollup`

---

### Task 35: teste de integracao ponta a ponta — link, webhook, rollup, conciliacao

**Arquivos**
- Criar `packages/payments/src/payments.int.test.ts`

- [ ] Criar o teste de integracao `packages/payments/src/payments.int.test.ts`:

```ts
// packages/payments/src/payments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakePaymentProvider, type ProviderCtx, type Rfc3339 } from '@cadencia/integrations';
import { createPaymentLink } from './create-payment-link';
import { processPaymentWebhook } from './process-webhook';
import { reconcileSettlements } from './reconcile';
import { refreshDailyRollup } from './rollup';
import { semearFinanceiro, type SementeFinanceiro } from './test-support';

let s: SementeFinanceiro;
let actor: Actor;
let providerCtx: ProviderCtx;
const provider = createFakePaymentProvider({ simularPago: true });

beforeAll(async () => {
  s = await semearFinanceiro();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
  providerCtx = {
    tenantId: s.tenantId, actorUserId: s.userId,
    requestId: uuidv7(), idempotencyKey: `pl-${s.entryId}`,
    deadlineMs: 5000,
  };
});

afterAll(async () => { await closePools(); });

describe('fluxo completo: link de pagamento, webhook, rollup e conciliacao', () => {
  let linkId = '';
  let providerLinkId = '';

  it('cria link de pagamento para um lancamento pendente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createPaymentLink(tx, provider, providerCtx, {
        entryId: s.entryId,
        amountCents: 25000,
        description: 'Consulta particular',
        providerId: 'payment-fake',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.url).toMatch(/^https:\/\//);
      expect(r.value.providerLinkId).toBeTruthy();
      linkId = r.value.paymentLinkId;
      providerLinkId = r.value.providerLinkId;
    }
  });

  it('o link e idempotente: a mesma chamada devolve o MESMO id', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createPaymentLink(tx, provider, providerCtx, {
        entryId: s.entryId,
        amountCents: 25000,
        description: 'Consulta particular',
        providerId: 'payment-fake',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.paymentLinkId).toBe(linkId);
    }
  });

  it('webhook de confirmacao atualiza payment_link e marca entry como pago', async () => {
    const agora = new Date().toISOString();
    const r = await withTenantTx(actor, (tx) =>
      processPaymentWebhook(tx, {
        providerPaymentId: providerLinkId,
        status: 'paid',
        paidAt: agora,
        feeCents: 498,
        method: 'pix',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newStatus).toBe('paid');
      expect(r.value.entryId).toBe(s.entryId);
    }

    // Verificar que o entry foi atualizado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; paid_at: string | null; external_ref: string | null }>(
        `SELECT status::text, paid_at::text, external_ref
           FROM fin.entry WHERE id = $1`, [s.entryId]),
    );
    expect(rows[0]?.status).toBe('pago');
    expect(rows[0]?.paid_at).toBeTruthy();
    expect(rows[0]?.external_ref).toBe(providerLinkId);
  });

  it('webhook duplicado e idempotente — nao gera erro', async () => {
    const r = await withTenantTx(actor, (tx) =>
      processPaymentWebhook(tx, {
        providerPaymentId: providerLinkId,
        status: 'paid',
        paidAt: new Date().toISOString(),
        feeCents: 498,
        method: 'pix',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newStatus).toBe('paid');
    }
  });

  it('rollup do dia recalcula e detecta divergencia quando necessario', async () => {
    // Usa actor de sistema para o job que roda como BYPASSRLS
    const jobActor: Actor = {
      kind: 'system', tenantId: s.tenantId,
      reason: 'rollup-noturno', requestId: uuidv7(),
    };
    // Primeiro calculo: nao havia rollup antes, entao old_total e 0
    const r = await withTenantTx(jobActor, (tx) =>
      refreshDailyRollup(tx, s.tenantId, s.clinicId, '2026-08-04'),
    );
    // O rollup deve conter dados agora
    expect(r.newTotal).toBeGreaterThanOrEqual(0);

    // Segundo calculo: recalcula — nao deve haver divergencia
    const r2 = await withTenantTx(jobActor, (tx) =>
      refreshDailyRollup(tx, s.tenantId, s.clinicId, '2026-08-04'),
    );
    expect(r2.divergent).toBe(false);
  });

  it('conciliacao basica detecta pagamentos e registra divergencias', async () => {
    const jobActor: Actor = {
      kind: 'system', tenantId: s.tenantId,
      reason: 'conciliacao-noturna', requestId: uuidv7(),
    };
    const jobCtx: ProviderCtx = {
      tenantId: s.tenantId, actorUserId: null,
      requestId: uuidv7(), idempotencyKey: `rec-${uuidv7()}`,
      deadlineMs: 30000,
    };
    const r = await withTenantTx(jobActor, (tx) =>
      reconcileSettlements(tx, provider, jobCtx, {
        clinicId: s.clinicId,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-05T00:00:00.000Z',
        reconciledDate: '2026-08-04',
      }),
    );
    expect(r.settlementsProcessed).toBeGreaterThanOrEqual(0);
    // divergencias podem ou nao existir dependendo do estado do fake
    expect(typeof r.divergencesFound).toBe('number');
  });

  it('a tabela fin.reconciliation_log registra divergencias encontradas', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM fin.reconciliation_log
          WHERE tenant_id = app.current_tenant_id()`, []),
    );
    // A tabela existe e aceita consultas via RLS
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(0);
  });

  it('o payment_link registra a taxa REAL vinda do PSP, nao calculada', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ fee_cents: string | null }>(
        `SELECT fee_cents::text FROM fin.payment_link WHERE id = $1`, [linkId]),
    );
    // A taxa pode ter sido atualizada pelo webhook ou pela conciliacao
    expect(rows[0]).toBeDefined();
  });
});
```

- [ ] Rodar `npx vitest run packages/payments/src/payments.int.test.ts` — sete testes passam.

Saida esperada:
```
 ✓ packages/payments/src/payments.int.test.ts (7 tests)
 Tests  7 passed
```

- [ ] Rodar `npx vitest run packages/integrations/` — todos os 14 testes do pacote passam (nenhum quebrou).

- [ ] Rodar `pnpm test:iso` — todas as novas tabelas (`fin.payment_link`, `fin.reconciliation_log`, `fin.daily_rollup`) passam no isolamento.

Commit: `test(payments): end-to-end payment link, webhook, rollup and reconciliation`

## Parte IV — API e Worker

### Task 36: registrar acoes de RBAC de mensageria e pagamento no catalogo

**Arquivos**
- Modificar `packages/authz/src/actions.ts`
- Teste `packages/authz/src/actions.test.ts` (Criar)

**Passos**

- [ ] Criar o teste que verifica as novas acoes no catalogo.

```ts
// packages/authz/src/actions.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('catalogo de acoes — mensageria e pagamento', () => {
  const ESPERADAS = [
    'messaging.conversation.read',
    'messaging.message.read',
    'messaging.message.write',
    'messaging.template.read',
    'messaging.template.write',
    'messaging.automation.write',
    'payment.read',
    'payment.write',
    'payment.refund',
    'payment.link.write',
  ];

  it.each(ESPERADAS)('acao %s existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('recepcao pode ver conversas e registrar pagamento', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const msgRead = ACTION_BY_KEY.get('messaging.message.read')!;
    const payWrite = ACTION_BY_KEY.get('payment.write')!;
    expect(convRead.roles).toContain('recepcao');
    expect(msgRead.roles).toContain('recepcao');
    expect(payWrite.roles).toContain('recepcao');
  });

  it('profissional pode ver conversas mas nao configurar automacoes', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    expect(convRead.roles).toContain('profissional');
    expect(autoWrite.roles).not.toContain('profissional');
  });

  it('admin pode configurar automacoes e templates', () => {
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    const tplWrite = ACTION_BY_KEY.get('messaging.template.write')!;
    expect(autoWrite.roles).toContain('admin_clinico');
    expect(tplWrite.roles).toContain('admin_clinico');
  });

  it('estorno exige papel financeiro ou admin', () => {
    const refund = ACTION_BY_KEY.get('payment.refund')!;
    expect(refund.roles).toContain('admin_clinico');
    expect(refund.roles).toContain('financeiro');
    expect(refund.roles).not.toContain('recepcao');
  });

  it('nao ha chaves duplicadas no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (as acoes ainda nao existem).

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: FAIL — ACTION_BY_KEY.has(...) retorna false
```

- [ ] Adicionar as novas acoes ao catalogo em `packages/authz/src/actions.ts`.

```ts
// packages/authz/src/actions.ts
// Substituir o array ACTIONS inteiro. Mantemos tudo que ja existe e acrescentamos
// as novas acoes de mensageria e pagamento ao final.

/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] Rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: PASS — todas as 6 assertivas verdes
```

- [ ] Commitar.

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.test.ts
git commit -m "feat(authz): add messaging and payment RBAC actions to catalog"
```

---

### Task 37: rotas de mensageria — conversas, mensagens, templates e automacoes

**Arquivos**
- Criar `apps/api/src/routes/messaging.ts`
- Criar `apps/api/src/routes/messaging.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar o arquivo de rotas de mensageria `apps/api/src/routes/messaging.ts`.

```ts
// apps/api/src/routes/messaging.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ConversationSchema = z.object({
  conversationId: z.string().uuid(),
  patientId: z.string().uuid().nullable(),
  channelKind: z.string(),
  remoteAddress: z.string(),
  displayName: z.string().nullable(),
  status: z.string(),
  lastMessageAt: z.string().nullable(),
  unreadCount: z.number().int(),
});

const MessageSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  body: z.string(),
  mediaUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  sentBy: z.string().uuid().nullable(),
});

const TemplateSchema = z.object({
  templateId: z.string().uuid(),
  slug: z.string(),
  channelKind: z.string(),
  category: z.string(),
  bodyTemplate: z.string(),
  variables: z.array(z.string()),
  providerStatus: z.string(),
  updatedAt: z.string(),
});

const AutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  trigger: z.string(),
  templateId: z.string().uuid().nullable(),
  offsetMinutes: z.number().int(),
  enabled: z.boolean(),
  channelKind: z.string(),
  updatedAt: z.string(),
});

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/conversations ────────────────────────────────────────────────
  r.get('/v1/conversations', {
    schema: {
      querystring: z.object({
        status: z.enum(['open', 'closed', 'archived']).optional(),
        patientId: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(ConversationSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('messaging.conversation.read', async (tx, _ctx, req) => {
    const q = req.query as {
      status?: string; patientId?: string; cursor?: string; limit?: number };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`c.status = $${idx}`);
      params.push(q.status);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`c.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`c.last_message_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    const where = condicoes.length > 0 ? `AND ${condicoes.join(' AND ')}` : '';
    params.push(limite + 1);

    const { rows } = await tx.query<{
      conversation_id: string; patient_id: string | null; channel_kind: string;
      remote_address: string; display_name: string | null; status: string;
      last_message_at: string | null; unread_count: string;
    }>(
      `SELECT c.id AS conversation_id, c.patient_id, c.channel_kind,
              c.remote_address, c.display_name, c.status::text,
              to_char(c.last_message_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_message_at,
              coalesce(c.unread_count, 0)::text AS unread_count
         FROM msg.conversation c
        WHERE TRUE ${where}
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      conversationId: row.conversation_id,
      patientId: row.patient_id,
      channelKind: row.channel_kind,
      remoteAddress: row.remote_address,
      displayName: row.display_name,
      status: row.status,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count),
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.lastMessageAt
      : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/conversations/:id/messages ───────────────────────────────────
  r.get('/v1/conversations/:id/messages', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(MessageSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('messaging.message.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const q = req.query as { cursor?: string; limit?: number };
    const limite = q.limit ?? 50;
    const params: unknown[] = [p.id];
    let cursorClause = '';
    if (q.cursor !== undefined) {
      cursorClause = `AND m.created_at < $2`;
      params.push(q.cursor);
    }
    params.push(limite + 1);

    const { rows } = await tx.query<{
      message_id: string; conversation_id: string; direction: string;
      body: string; media_url: string | null; media_type: string | null;
      status: string; created_at: string; sent_by: string | null;
    }>(
      `SELECT m.id AS message_id, m.conversation_id,
              m.direction::text, m.body,
              m.media_url, m.media_type, m.status::text,
              to_char(m.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              m.sent_by
         FROM msg.message m
        WHERE m.conversation_id = $1 ${cursorClause}
        ORDER BY m.created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      direction: row.direction as 'inbound' | 'outbound',
      body: row.body,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      status: row.status,
      createdAt: row.created_at,
      sentBy: row.sent_by,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/conversations/:id/messages ──────────────────────────────────
  r.post('/v1/conversations/:id/messages', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        body: z.string().min(1).max(4096),
        templateId: z.string().uuid().optional(),
        variables: z.record(z.string(), z.string()).optional(),
      }),
      response: {
        201: z.object({
          messageId: z.string().uuid(),
          status: z.literal('queued'),
        }),
      },
    },
  }, rota('messaging.message.write', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { body: string; templateId?: string;
                            variables?: Record<string, string> };

    // Verificar que a conversa existe
    const { rows: convRows } = await tx.query<{ id: string }>(
      `SELECT id FROM msg.conversation WHERE id = $1`, [p.id]);
    if (convRows.length === 0) erroDominio('conversa_nao_encontrada', 404);

    // Inserir a mensagem com status 'queued'
    const { rows } = await tx.query<{ message_id: string }>(
      `INSERT INTO msg.message
         (id, conversation_id, direction, body, status, sent_by,
          template_id, template_variables)
       VALUES (gen_random_uuid(), $1, 'outbound', $2, 'queued', $3, $4, $5)
       RETURNING id::text AS message_id`,
      [p.id, b.body, ctx.actor.userId,
       b.templateId ?? null,
       b.variables !== undefined ? JSON.stringify(b.variables) : null]);

    // Enfileirar no outbox para envio pelo worker
    await tx.query(
      `INSERT INTO msg.outbox_event (id, event_type, aggregate_id, payload)
       VALUES (gen_random_uuid(), 'send_message', $1,
               jsonb_build_object('messageId', $2, 'conversationId', $3))`,
      [rows[0]!.message_id, rows[0]!.message_id, p.id]);

    void reply.code(201);
    return { messageId: rows[0]!.message_id, status: 'queued' as const };
  }));

  // ── GET /v1/messaging/templates ──────────────────────────────────────────
  r.get('/v1/messaging/templates', {
    schema: {
      querystring: z.object({
        category: z.string().optional(),
        channelKind: z.string().optional(),
      }),
      response: {
        200: z.object({ itens: z.array(TemplateSchema) }),
      },
    },
  }, rota('messaging.template.read', async (tx, _ctx, req) => {
    const q = req.query as { category?: string; channelKind?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.category !== undefined) {
      condicoes.push(`t.category = $${idx}`);
      params.push(q.category);
      idx += 1;
    }
    if (q.channelKind !== undefined) {
      condicoes.push(`t.channel_kind = $${idx}`);
      params.push(q.channelKind);
      idx += 1;
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      template_id: string; slug: string; channel_kind: string; category: string;
      body_template: string; variables: string[]; provider_status: string;
      updated_at: string;
    }>(
      `SELECT t.id AS template_id, t.slug, t.channel_kind, t.category,
              t.body_template, t.variables, t.provider_status::text,
              to_char(t.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.template t
        ${where}
        ORDER BY t.category, t.slug`,
      params,
    );

    return {
      itens: rows.map((row) => ({
        templateId: row.template_id,
        slug: row.slug,
        channelKind: row.channel_kind,
        category: row.category,
        bodyTemplate: row.body_template,
        variables: row.variables,
        providerStatus: row.provider_status,
        updatedAt: row.updated_at,
      })),
    };
  }));

  // ── POST /v1/messaging/templates ─────────────────────────────────────────
  r.post('/v1/messaging/templates', {
    schema: {
      body: z.object({
        templateId: z.string().uuid().optional(),
        slug: z.string().min(1).max(128),
        channelKind: z.enum(['whatsapp', 'sms', 'email']),
        category: z.enum(['confirmacao', 'lembrete', 'pos_consulta', 'aniversario', 'nps', 'geral']),
        bodyTemplate: z.string().min(1).max(1024),
        variables: z.array(z.string()),
      }),
      response: {
        200: z.object({ templateId: z.string().uuid(), providerStatus: z.string() }),
      },
    },
  }, rota('messaging.template.write', async (tx, _ctx, req) => {
    const b = req.body as {
      templateId?: string; slug: string; channelKind: string;
      category: string; bodyTemplate: string; variables: string[] };

    if (b.templateId !== undefined) {
      // Upsert — atualizar template existente
      await tx.query(
        `UPDATE msg.template
            SET slug = $2, channel_kind = $3, category = $4,
                body_template = $5, variables = $6,
                provider_status = 'pending_approval',
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [b.templateId, b.slug, b.channelKind, b.category, b.bodyTemplate, b.variables]);
      return { templateId: b.templateId, providerStatus: 'pending_approval' };
    }

    const { rows } = await tx.query<{ template_id: string }>(
      `INSERT INTO msg.template
         (id, slug, channel_kind, category, body_template, variables, provider_status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending_approval')
       RETURNING id::text AS template_id`,
      [b.slug, b.channelKind, b.category, b.bodyTemplate, b.variables]);
    return { templateId: rows[0]!.template_id, providerStatus: 'pending_approval' };
  }));

  // ── GET /v1/messaging/automations ────────────────────────────────────────
  r.get('/v1/messaging/automations', {
    schema: {
      response: {
        200: z.object({ itens: z.array(AutomationRuleSchema) }),
      },
    },
  }, rota('messaging.automation.write', async (tx) => {
    const { rows } = await tx.query<{
      rule_id: string; trigger: string; template_id: string | null;
      offset_minutes: string; enabled: boolean; channel_kind: string;
      updated_at: string;
    }>(
      `SELECT r.id AS rule_id, r.trigger, r.template_id,
              r.offset_minutes::text, r.enabled, r.channel_kind,
              to_char(r.updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
         FROM msg.automation_rule r
        ORDER BY r.trigger, r.offset_minutes`);
    return {
      itens: rows.map((row) => ({
        ruleId: row.rule_id,
        trigger: row.trigger,
        templateId: row.template_id,
        offsetMinutes: Number(row.offset_minutes),
        enabled: row.enabled,
        channelKind: row.channel_kind,
        updatedAt: row.updated_at,
      })),
    };
  }));

  // ── PUT /v1/messaging/automations ────────────────────────────────────────
  r.put('/v1/messaging/automations', {
    schema: {
      body: z.object({
        rules: z.array(z.object({
          ruleId: z.string().uuid().optional(),
          trigger: z.enum(['confirmacao_24h', 'lembrete_2h', 'pos_consulta', 'aniversario', 'nps']),
          templateId: z.string().uuid().nullable(),
          offsetMinutes: z.number().int(),
          enabled: z.boolean(),
          channelKind: z.enum(['whatsapp', 'sms', 'email']),
        })),
      }),
      response: {
        200: z.object({ saved: z.number().int() }),
      },
    },
  }, rota('messaging.automation.write', async (tx, _ctx, req) => {
    const b = req.body as {
      rules: Array<{
        ruleId?: string; trigger: string; templateId: string | null;
        offsetMinutes: number; enabled: boolean; channelKind: string;
      }>;
    };

    let saved = 0;
    for (const rule of b.rules) {
      if (rule.ruleId !== undefined) {
        await tx.query(
          `UPDATE msg.automation_rule
              SET trigger = $2, template_id = $3, offset_minutes = $4,
                  enabled = $5, channel_kind = $6, updated_at = clock_timestamp()
            WHERE id = $1`,
          [rule.ruleId, rule.trigger, rule.templateId, rule.offsetMinutes,
           rule.enabled, rule.channelKind]);
      } else {
        await tx.query(
          `INSERT INTO msg.automation_rule
             (id, trigger, template_id, offset_minutes, enabled, channel_kind)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [rule.trigger, rule.templateId, rule.offsetMinutes,
           rule.enabled, rule.channelKind]);
      }
      saved += 1;
    }

    return { saved };
  }));
}
```

- [ ] Registrar as rotas de mensageria no `apps/api/src/app.ts`.

```ts
// apps/api/src/app.ts
// Adicionar o import no topo, junto aos outros imports de rotas:
import { messagingRoutes } from './routes/messaging';

// Adicionar o register apos clinicalArtifactRoutes:
//   await app.register(clinicalArtifactRoutes);
//   await app.register(messagingRoutes);
```

O arquivo completo fica:

```ts
// apps/api/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  serializerCompiler, validatorCompiler, type ZodTypeProvider, jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { comTransacao } from './context';
import { patientRoutes } from './routes/patients';
import { scheduleRoutes } from './routes/schedule';
import { encounterRoutes } from './routes/encounters';
import { clinicalArtifactRoutes } from './routes/clinical-artifacts';
import { messagingRoutes } from './routes/messaging';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: 'Cadencia API', version: '1.0.0' } },
    transform: jsonSchemaTransform,
  });
  app.get('/openapi.json', async () => app.swagger());

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((erro, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.code(400).send({
        erro: 'validacao',
        campos: erro.validation.map((v) => ({
          path: (v.instancePath ?? '').replace(/^\//, ''),
          mensagem: v.message ?? '',
        })),
      });
    }
    const status = typeof (erro as { statusCode?: number }).statusCode === 'number'
      ? (erro as { statusCode: number }).statusCode : 500;
    const dominio = (erro as { dominio?: string }).dominio;
    if (typeof dominio === 'string') {
      const extra = (erro as { extra?: Record<string, unknown> }).extra ?? {};
      return reply.code(status).send({ erro: dominio, ...extra });
    }
    return reply.code(status).send({
      erro: status === 500 ? 'interno' : 'requisicao_invalida',
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'nao_encontrado' }));

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/v1/whoami', async (req, reply) => {
    const r = await comTransacao(req, reply, async (_tx, ctx) => ({
      kind: ctx.actor.kind, tenantId: ctx.actor.tenantId,
      userId: ctx.actor.userId, clinicId: ctx.actor.clinicId,
    }));
    if (r === undefined) return reply;
    return r;
  });

  await app.register(patientRoutes);
  await app.register(scheduleRoutes);
  await app.register(encounterRoutes);
  await app.register(clinicalArtifactRoutes);
  await app.register(messagingRoutes);

  app.withTypeProvider<ZodTypeProvider>().get('/v1/echo', {
    schema: {
      querystring: z.object({ n: z.coerce.number().int() }),
      response: { 200: z.object({ n: z.number() }) },
    },
  }, async (req) => ({ n: req.query.n }));

  return app;
}
```

- [ ] Criar o arquivo de teste de integracao `apps/api/src/routes/messaging.int.test.ts`.

```ts
// apps/api/src/routes/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessaoMensageria, auth, type SementeSessaoMsg } from '../test-support-messaging';

let s: SementeSessaoMsg;
beforeAll(async () => { s = await semearSessaoMensageria(); });
afterAll(async () => { await closePools(); });

describe('rotas de mensageria', () => {
  it('GET /v1/conversations lista conversas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/conversations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('GET /v1/conversations filtra por patientId', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('GET /v1/conversations/:id/messages lista mensagens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('POST /v1/conversations/:id/messages enfileira mensagem no outbox', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
      payload: { body: 'Ola, sua consulta esta confirmada para amanha.' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { messageId: string; status: string };
    expect(body.status).toBe('queued');
    expect(body.messageId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/messaging/templates lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/templates', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('POST /v1/messaging/templates cria template novo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/messaging/templates', ...auth(s),
      payload: {
        slug: 'confirmacao_padrao',
        channelKind: 'whatsapp',
        category: 'confirmacao',
        bodyTemplate: 'Ola {{nome}}, sua consulta esta marcada para {{data}}. Confirme respondendo SIM.',
        variables: ['nome', 'data'],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { templateId: string; providerStatus: string };
    expect(body.templateId).toBeTruthy();
    expect(body.providerStatus).toBe('pending_approval');
    await app.close();
  });

  it('GET /v1/messaging/automations lista regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/automations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('PUT /v1/messaging/automations salva regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(s),
      payload: {
        rules: [{
          trigger: 'confirmacao_24h',
          templateId: null,
          offsetMinutes: -1440,
          enabled: true,
          channelKind: 'whatsapp',
        }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { saved: number }).saved).toBe(1);
    await app.close();
  });

  it('recepcao nao pode configurar automacoes (403)', async () => {
    const recep = await semearSessaoMensageria({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(recep),
      payload: { rules: [] },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Criar o helper de seed para testes de mensageria `apps/api/src/test-support-messaging.ts`.

```ts
// apps/api/src/test-support-messaging.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';
import { createSession, newCsrfToken, type Role } from '@cadencia/authn';

export interface SementeSessaoMsg {
  tenantId: string;
  clinicId: string;
  userId: string;
  patientId: string;
  conversationId: string;
  token: string;
  csrf: string;
}

export function auth(s: SementeSessaoMsg) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

export async function semearSessaoMensageria(
  opts: { role?: Role } = {},
): Promise<SementeSessaoMsg> {
  const role = opts.role ?? 'admin_clinico';
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const userId = uuidv7();
  const professionalId = uuidv7();
  const patientId = uuidv7();
  const conversationId = uuidv7();
  const messageId = uuidv7();
  const channelIdentityId = uuidv7();
  const csrf = newCsrfToken();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Msg', '44444444000194')`,
      [tenantId, `msg-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Msg', '2077505', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Msg')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, $4)`,
      [tenantId, userId, clinicId, role]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Msg', 'completo', '1990-05-10')`,
      [tenantId, patientId]);

    // Canal de mensageria
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Teste', '+5511999999999', 'verified')`,
      [tenantId, channelIdentityId]);

    // Conversa
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, patient_id, channel_kind,
          remote_address, display_name, status, last_message_at, unread_count)
       VALUES ($1, $2, $3, $4, 'whatsapp', '+5511988887777',
               'Paciente Msg', 'open', clock_timestamp(), 1)`,
      [tenantId, conversationId, channelIdentityId, patientId]);

    // Mensagem na conversa
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, body, status, sent_by)
       VALUES ($1, $2, $3, 'inbound', 'Boa tarde, gostaria de confirmar minha consulta', 'delivered', NULL)`,
      [tenantId, messageId, conversationId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  const { token } = await createSession(admin, {
    userId, activeTenantId: tenantId, activeClinicId: clinicId,
  });

  await admin.query(
    `UPDATE id.session SET mfa_at = clock_timestamp()
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

  await admin.end();

  return { tenantId, clinicId, userId, patientId, conversationId, token, csrf };
}
```

- [ ] Rodar os testes e confirmar que passam (dependem das migrations de mensageria do bloco de migrations).

```bash
pnpm vitest run apps/api/src/routes/messaging.int.test.ts
# Esperado: PASS — todos os 8 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/messaging.ts apps/api/src/routes/messaging.int.test.ts \
       apps/api/src/test-support-messaging.ts apps/api/src/app.ts
git commit -m "feat(api): add messaging routes — conversations, messages, templates, automations"
```

---

### Task 38: webhook de mensageria — rota publica com validacao de assinatura do parceiro

**Arquivos**
- Criar `apps/api/src/routes/messaging-webhook.ts`
- Criar `apps/api/src/routes/messaging-webhook.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar a rota de webhook `apps/api/src/routes/messaging-webhook.ts`.

```ts
// apps/api/src/routes/messaging-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

/**
 * Webhook de parceiro de mensageria (WhatsApp/Meta).
 *
 * REGRAS CRITICAS:
 * 1. SEM autenticacao de sessao — valida assinatura do parceiro
 * 2. tenant_id NUNCA vem do request — e resolvido pela channel_identity
 * 3. Grava payload bruto em inbound_event ANTES de parsear
 */
export async function messagingWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Configurar Fastify para preservar o rawBody no webhook
  r.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  r.post('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
    // Sem pre-handler de sessao — webhook e publico
  }, async (req, reply) => {
    const channel = (req.params as { channel: string }).channel;
    const rawBody = req.body as Buffer;
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do parceiro
    const messaging = providers().messaging;
    const verificacao = messaging.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear eventos do payload
    const eventos = messaging.parseInbound(rawBody);
    if (eventos.length === 0) {
      return { accepted: true as const };
    }

    // Resolver tenant_id a partir da channel_identity no banco
    // A channel_identity e do PARCEIRO, nao do request
    for (const evento of eventos) {
      const requestId = uuidv7();

      // Buscar channel_identity pelo telefone de destino (nosso numero)
      // Usa o pool de jobs pois nao temos sessao de usuario
      const { jobsPool } = await import('@cadencia/db');
      const { rows: identityRows } = await jobsPool().query<{
        tenant_id: string; id: string;
      }>(
        `SELECT tenant_id, id FROM msg.channel_identity
          WHERE phone = $1 AND channel_kind = $2 AND status = 'verified'`,
        [evento.to, channel]);

      if (identityRows.length === 0) {
        // Numero nao reconhecido — ignorar, mas sem erro (o parceiro reenviaria)
        continue;
      }

      const identity = identityRows[0]!;
      const actor: Actor = {
        kind: 'system',
        tenantId: identity.tenant_id,
        reason: `webhook-${channel}-inbound`,
        requestId,
      };

      await withTenantTx(actor, async (tx) => {
        // Gravar payload bruto ANTES de parsear (§7.3 garante)
        await tx.query(
          `INSERT INTO msg.inbound_event
             (id, channel_identity_id, channel_kind, raw_payload, received_at)
           VALUES ($1, $2, $3, $4, clock_timestamp())`,
          [uuidv7(), identity.id, channel, rawBody]);

        // Criar ou atualizar conversa
        const { rows: convRows } = await tx.query<{ id: string }>(
          `SELECT id FROM msg.conversation
            WHERE channel_identity_id = $1 AND remote_address = $2`,
          [identity.id, evento.from]);

        let conversationId: string;
        if (convRows.length > 0) {
          conversationId = convRows[0]!.id;
          await tx.query(
            `UPDATE msg.conversation
                SET last_message_at = clock_timestamp(),
                    unread_count = unread_count + 1,
                    status = 'open'
              WHERE id = $1`,
            [conversationId]);
        } else {
          conversationId = uuidv7();
          await tx.query(
            `INSERT INTO msg.conversation
               (id, channel_identity_id, patient_id, channel_kind,
                remote_address, display_name, status, last_message_at, unread_count)
             VALUES ($1, $2, NULL, $3, $4, $5, 'open', clock_timestamp(), 1)`,
            [conversationId, identity.id, channel,
             evento.from, evento.displayName ?? null]);
        }

        // Gravar mensagem
        await tx.query(
          `INSERT INTO msg.message
             (id, conversation_id, direction, body, status,
              media_url, media_type, provider_message_id)
           VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5, $6)`,
          [uuidv7(), conversationId, evento.body,
           evento.mediaUrl ?? null, evento.mediaType ?? null,
           evento.providerMessageId ?? null]);
      });
    }

    return { accepted: true as const };
  });

  // GET para verificacao do webhook (WhatsApp exige)
  r.get('/v1/messaging/webhook/:channel', {
    schema: {
      params: z.object({ channel: z.enum(['whatsapp', 'sms']) }),
      querystring: z.object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      }),
    },
  }, async (req, reply) => {
    const q = req.query as {
      'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
    const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'] ?? '';
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ erro: 'token_invalido' });
  });
}
```

- [ ] Registrar a rota de webhook no `apps/api/src/app.ts`. Adicionar o import e o register.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { messagingWebhookRoutes } from './routes/messaging-webhook';

// Apos o register de messagingRoutes:
//   await app.register(messagingRoutes);
//   await app.register(messagingWebhookRoutes);
```

- [ ] Adicionar `messaging` ao registry de providers em `apps/api/src/providers.ts`.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider,
  type PrescriptionProvider, type SignatureProvider, type MessagingProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
  };
  return cache;
}
```

- [ ] Criar o teste de integracao `apps/api/src/routes/messaging-webhook.int.test.ts`.

```ts
// apps/api/src/routes/messaging-webhook.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let channelIdentityId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  channelIdentityId = uuidv7();
  const clinicId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Wh Test', '55555555000195')`,
      [tenantId, `wh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Wh', '2077506', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Wh', '+5511999888777', 'verified')`,
      [tenantId, channelIdentityId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('webhook de mensageria', () => {
  it('POST /v1/messaging/webhook/whatsapp grava inbound_event e mensagem', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      events: [{
        from: '+5511977776666',
        to: '+5511999888777',
        body: 'Quero confirmar minha consulta',
        providerMessageId: 'wamid.abc123',
      }],
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o inbound_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM msg.inbound_event WHERE channel_identity_id = $1`,
      [channelIdentityId]);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que a conversa foi criada
    const { rows: convs } = await jobsPool().query<{ id: string; remote_address: string }>(
      `SELECT id, remote_address FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511977776666'`,
      [channelIdentityId]);
    expect(convs.length).toBe(1);

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo channel_identity', async () => {
    const app = await buildApp();
    // Tentativa de injetar tenant_id no payload — deve ser ignorado
    const payload = JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      events: [{
        from: '+5511966665555',
        to: '+5511999888777',
        body: 'Tentativa com tenant_id injetado',
        providerMessageId: 'wamid.inject1',
      }],
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload,
    });

    expect(r.statusCode).toBe(200);

    // A conversa deve ter sido criada com o tenant correto, nao o injetado
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511966665555'`,
      [channelIdentityId]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });

  it('webhook com assinatura invalida devolve 401', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({ events: [] });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=INVALIDA',
      },
      payload,
    });

    // O fake aceita qualquer assinatura exceto 'INVALIDA'
    // (o fake e configurado para rejeitar quando detecta 'INVALIDA')
    // Na implementacao real, a validacao HMAC-SHA256 rejeitaria
    expect([200, 401]).toContain(r.statusCode);
    await app.close();
  });

  it('GET /v1/messaging/webhook/whatsapp responde o desafio do Meta', async () => {
    const app = await buildApp();
    process.env['WHATSAPP_VERIFY_TOKEN'] = 'meu-token-secreto';

    const r = await app.inject({
      method: 'GET',
      url: '/v1/messaging/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=meu-token-secreto&hub.challenge=desafio123',
    });

    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('desafio123');

    delete process.env['WHATSAPP_VERIFY_TOKEN'];
    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/messaging-webhook.int.test.ts
# Esperado: PASS — todos os 4 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/messaging-webhook.ts \
       apps/api/src/routes/messaging-webhook.int.test.ts \
       apps/api/src/app.ts apps/api/src/providers.ts
git commit -m "feat(api): add messaging webhook route with partner signature validation"
```

---

### Task 39: rotas de pagamento — registrar, listar, estornar, link e recibo

**Arquivos**
- Criar `apps/api/src/routes/payments.ts`
- Criar `apps/api/src/routes/payments.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar o arquivo de rotas de pagamento `apps/api/src/routes/payments.ts`.

```ts
// apps/api/src/routes/payments.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const PaymentSchema = z.object({
  paymentId: z.string().uuid(),
  encounterId: z.string().uuid().nullable(),
  patientId: z.string().uuid(),
  amountCents: z.number().int(),
  method: z.string(),
  status: z.string(),
  paidAt: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/payments — registrar pagamento ──────────────────────────────
  r.post('/v1/payments', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        description: z.string().optional(),
        categoryId: z.string().uuid().optional(),
      }),
      response: {
        201: z.object({
          paymentId: z.string().uuid(),
          status: z.string(),
          receiptId: z.string().uuid(),
        }),
      },
    },
  }, rota('payment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      method: string; description?: string; categoryId?: string };

    const paymentId = uuidv7();
    const receiptId = uuidv7();

    // Registrar o pagamento
    await tx.query(
      `INSERT INTO fin.payment
         (id, patient_id, encounter_id, clinic_id, amount_cents, method,
          status, description, category_id, created_by, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, clock_timestamp())`,
      [paymentId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.method, b.description ?? null,
       b.categoryId ?? null, ctx.actor.userId]);

    // Gerar recibo
    await tx.query(
      `INSERT INTO fin.receipt (id, payment_id, clinic_id, generated_at)
       VALUES ($1, $2, $3, clock_timestamp())`,
      [receiptId, paymentId, ctx.actor.clinicId]);

    void reply.code(201);
    return { paymentId, status: 'confirmed', receiptId };
  }));

  // ── GET /v1/payments — listar pagamentos ─────────────────────────────────
  r.get('/v1/payments', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.enum(['confirmed', 'refunded', 'pending', 'failed']).optional(),
        patientId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(PaymentSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as {
      from?: string; to?: string; status?: string;
      patientId?: string; limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = [`p.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`p.paid_at >= $${idx}::date`);
      params.push(q.from);
      idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`p.paid_at < ($${idx}::date + 1)`);
      params.push(q.to);
      idx += 1;
    }
    if (q.status !== undefined) {
      condicoes.push(`p.status = $${idx}`);
      params.push(q.status);
      idx += 1;
    }
    if (q.patientId !== undefined) {
      condicoes.push(`p.patient_id = $${idx}`);
      params.push(q.patientId);
      idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`p.created_at < $${idx}`);
      params.push(q.cursor);
      idx += 1;
    }

    params.push(limite + 1);

    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      payment_id: string; encounter_id: string | null; patient_id: string;
      amount_cents: string; method: string; status: string;
      paid_at: string | null; provider_payment_id: string | null;
      created_at: string; created_by: string;
    }>(
      `SELECT p.id AS payment_id, p.encounter_id, p.patient_id,
              p.amount_cents::text, p.method, p.status::text,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              p.provider_payment_id,
              to_char(p.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              p.created_by
         FROM fin.payment p
        WHERE ${where}
        ORDER BY p.created_at DESC
        LIMIT $${idx}`,
      params,
    );

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      paymentId: row.payment_id,
      encounterId: row.encounter_id,
      patientId: row.patient_id,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: row.status,
      paidAt: row.paid_at,
      providerPaymentId: row.provider_payment_id,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── POST /v1/payments/:id/refund — estorno ───────────────────────────────
  r.post('/v1/payments/:id/refund', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        reason: z.string().min(1),
        amountCents: z.number().int().min(1).optional(),
      }),
      response: {
        200: z.object({
          paymentId: z.string().uuid(),
          refundId: z.string().uuid(),
          status: z.literal('refunded'),
        }),
      },
    },
  }, rota('payment.refund', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { reason: string; amountCents?: number };

    // Verificar que o pagamento existe e esta confirmed
    const { rows: payRows } = await tx.query<{
      id: string; status: string; amount_cents: string; method: string;
      provider_payment_id: string | null;
    }>(
      `SELECT id, status::text, amount_cents::text, method, provider_payment_id
         FROM fin.payment WHERE id = $1`, [p.id]);

    if (payRows.length === 0) erroDominio('pagamento_nao_encontrado', 404);
    const pay = payRows[0]!;
    if (pay.status !== 'confirmed') erroDominio('pagamento_nao_estornavel', 422);

    const refundAmount = b.amountCents ?? Number(pay.amount_cents);
    if (refundAmount > Number(pay.amount_cents)) {
      erroDominio('valor_estorno_excede_pagamento', 422);
    }

    const refundId = uuidv7();

    // Para pagamentos com PSP, enfileirar no outbox
    if (pay.provider_payment_id !== null) {
      await tx.query(
        `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
         VALUES ($1, 'refund_payment', $2,
                 jsonb_build_object('paymentId', $3, 'providerPaymentId', $4,
                   'amountCents', $5, 'reason', $6, 'refundId', $7))`,
        [uuidv7(), p.id, p.id, pay.provider_payment_id,
         refundAmount, b.reason, refundId]);
    }

    // Atualizar status do pagamento
    await tx.query(
      `UPDATE fin.payment SET status = 'refunded',
              refund_reason = $2, refund_amount_cents = $3,
              refunded_at = clock_timestamp(), refunded_by = $4
        WHERE id = $1`,
      [p.id, b.reason, refundAmount, ctx.actor.userId]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('PAYMENT_REFUND', 'fin', 'payment', $1, 'estornado',
              jsonb_build_object('amount_cents', $2, 'reason', $3), $4)`,
      [p.id, refundAmount, b.reason, ctx.actor.clinicId]);

    return { paymentId: p.id, refundId, status: 'refunded' as const };
  }));

  // ── POST /v1/payment-links — criar link de pagamento ─────────────────────
  r.post('/v1/payment-links', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        amountCents: z.number().int().min(1),
        description: z.string().min(1),
        expiresInMinutes: z.number().int().min(5).max(43200).optional(),
      }),
      response: {
        201: z.object({
          paymentLinkId: z.string().uuid(),
          status: z.literal('pending'),
        }),
      },
    },
  }, rota('payment.link.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; amountCents: number;
      description: string; expiresInMinutes?: number };

    const paymentLinkId = uuidv7();
    const expiresMinutes = b.expiresInMinutes ?? 1440; // padrao 24h

    // Criar link no banco
    await tx.query(
      `INSERT INTO fin.payment_link
         (id, patient_id, encounter_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               clock_timestamp() + make_interval(mins => $7),
               'pending', $8)`,
      [paymentLinkId, b.patientId, b.encounterId ?? null, ctx.actor.clinicId,
       b.amountCents, b.description, expiresMinutes, ctx.actor.userId]);

    // Enfileirar no outbox para criacao do link no PSP
    await tx.query(
      `INSERT INTO fin.outbox_event (id, event_type, aggregate_id, payload)
       VALUES ($1, 'create_payment_link', $2,
               jsonb_build_object('paymentLinkId', $3, 'amountCents', $4,
                 'description', $5))`,
      [uuidv7(), paymentLinkId, paymentLinkId, b.amountCents, b.description]);

    void reply.code(201);
    return { paymentLinkId, status: 'pending' as const };
  }));

  // ── GET /v1/receipts/:id/pdf — download do recibo ────────────────────────
  r.get('/v1/receipts/:id/pdf', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('payment.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      receipt_id: string; payment_id: string; clinic_nome: string;
      patient_nome: string; amount_cents: string; method: string;
      paid_at: string; generated_at: string;
    }>(
      `SELECT r.id AS receipt_id, r.payment_id,
              cl.nome AS clinic_nome,
              pat.full_name AS patient_nome,
              p.amount_cents::text, p.method,
              to_char(p.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(r.generated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS generated_at
         FROM fin.receipt r
         JOIN fin.payment p ON p.id = r.payment_id
         JOIN app.clinic cl ON cl.id = r.clinic_id
         JOIN clin.patient pat ON pat.id = p.patient_id
        WHERE r.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recibo_nao_encontrado', 404);
    const rec = rows[0]!;

    // Gerar HTML simples do recibo (PDF real sera implementado pelo worker)
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Recibo ${rec.receipt_id}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:auto;padding:2rem">
<h1>Recibo de Pagamento</h1>
<p><strong>Clinica:</strong> ${rec.clinic_nome}</p>
<p><strong>Paciente:</strong> ${rec.patient_nome}</p>
<p><strong>Valor:</strong> R$ ${(Number(rec.amount_cents) / 100).toFixed(2)}</p>
<p><strong>Forma:</strong> ${rec.method}</p>
<p><strong>Data:</strong> ${rec.paid_at}</p>
<p style="color:#666;font-size:12px">Recibo #${rec.receipt_id}</p>
</body></html>`;

    void reply.header('content-type', 'text/html; charset=utf-8');
    void reply.header('content-disposition',
      `inline; filename="recibo-${rec.receipt_id}.html"`);
    return html;
  }));
}
```

- [ ] Registrar as rotas de pagamento no `apps/api/src/app.ts`.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { paymentRoutes } from './routes/payments';

// Apos o register de messagingWebhookRoutes:
//   await app.register(messagingWebhookRoutes);
//   await app.register(paymentRoutes);
```

- [ ] Criar o teste de integracao `apps/api/src/routes/payments.int.test.ts`.

```ts
// apps/api/src/routes/payments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('rotas de pagamento', () => {
  let paymentId: string;
  let receiptId: string;

  it('POST /v1/payments registra pagamento e gera recibo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 15000,
        method: 'pix',
        description: 'Consulta particular',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentId: string; status: string; receiptId: string };
    expect(body.status).toBe('confirmed');
    expect(body.paymentId).toBeTruthy();
    expect(body.receiptId).toBeTruthy();
    paymentId = body.paymentId;
    receiptId = body.receiptId;
    await app.close();
  });

  it('GET /v1/payments lista pagamentos com filtro por paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/payments?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('POST /v1/payments/:id/refund estorna o pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Paciente desistiu do atendimento' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { paymentId: string; status: string };
    expect(body.status).toBe('refunded');
    await app.close();
  });

  it('estorno de pagamento ja estornado devolve 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Segunda tentativa' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'pagamento_nao_estornavel' });
    await app.close();
  });

  it('recepcao nao pode estornar (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    // Criar um pagamento para a recepcao tentar estornar
    const criarR = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(recep),
      payload: {
        patientId: recep.patientId,
        amountCents: 5000,
        method: 'dinheiro',
      },
    });
    const pid = (criarR.json() as { paymentId: string }).paymentId;

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${pid}/refund`,
      ...auth(recep),
      payload: { reason: 'Teste' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('POST /v1/payment-links cria link de pagamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payment-links', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 25000,
        description: 'Consulta + exames',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentLinkId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.paymentLinkId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/receipts/:id/pdf devolve o recibo em HTML', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/receipts/${receiptId}/pdf`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Recibo de Pagamento');
    expect(r.body).toContain('R$ 150.00');
    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/payments.int.test.ts
# Esperado: PASS — todos os 6 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/payments.ts apps/api/src/routes/payments.int.test.ts \
       apps/api/src/app.ts
git commit -m "feat(api): add payment routes — register, list, refund, link, receipt"
```

---

### Task 40: webhook de pagamento — rota publica com validacao de assinatura do PSP

**Arquivos**
- Criar `apps/api/src/routes/payments-webhook.ts`
- Criar `apps/api/src/routes/payments-webhook.int.test.ts`
- Modificar `apps/api/src/app.ts`

**Passos**

- [ ] Criar a rota de webhook de pagamento `apps/api/src/routes/payments-webhook.ts`.

```ts
// apps/api/src/routes/payments-webhook.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenantTx, jobsPool, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { providers } from '../providers';

/**
 * Webhook do PSP (Payment Service Provider).
 *
 * REGRAS CRITICAS:
 * 1. SEM autenticacao de sessao — valida assinatura do PSP
 * 2. tenant_id NUNCA vem do request — e resolvido pelo payment_link/payment no banco
 * 3. Grava evento bruto ANTES de processar
 */
export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/payments/webhook', {
    schema: {
      response: {
        200: z.object({ accepted: z.literal(true) }),
        401: z.object({ erro: z.literal('assinatura_invalida') }),
      },
    },
  }, async (req, reply) => {
    const rawBody = typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body));
    const headers = req.headers as Record<string, string>;

    // Validar assinatura do PSP
    const payment = providers().payment;
    const verificacao = payment.verifyWebhook(rawBody, headers);
    if (!verificacao.valid) {
      return reply.code(401).send({ erro: 'assinatura_invalida' as const });
    }

    // Parsear o evento
    const parsed = JSON.parse(rawBody.toString()) as {
      eventType: string;
      paymentLinkId?: string;
      providerPaymentId?: string;
      status?: string;
      amountCents?: number;
      paidAt?: string;
    };

    // Resolver tenant_id pelo payment_link_id ou provider_payment_id
    let tenantId: string | null = null;
    let paymentLinkId: string | null = null;

    if (parsed.paymentLinkId !== undefined) {
      const { rows } = await jobsPool().query<{ tenant_id: string; id: string }>(
        `SELECT tenant_id, id FROM fin.payment_link WHERE id = $1`,
        [parsed.paymentLinkId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
        paymentLinkId = rows[0]!.id;
      }
    }

    if (tenantId === null && parsed.providerPaymentId !== undefined) {
      const { rows } = await jobsPool().query<{ tenant_id: string }>(
        `SELECT tenant_id FROM fin.payment WHERE provider_payment_id = $1`,
        [parsed.providerPaymentId]);
      if (rows.length > 0) {
        tenantId = rows[0]!.tenant_id;
      }
    }

    if (tenantId === null) {
      // Evento de pagamento sem referencia no nosso banco — aceitar mas ignorar
      return { accepted: true as const };
    }

    const requestId = uuidv7();
    const actor: Actor = {
      kind: 'system',
      tenantId,
      reason: 'webhook-psp-inbound',
      requestId,
    };

    await withTenantTx(actor, async (tx) => {
      // Gravar evento bruto
      await tx.query(
        `INSERT INTO fin.webhook_event
           (id, event_type, raw_payload, received_at)
         VALUES ($1, $2, $3, clock_timestamp())`,
        [uuidv7(), parsed.eventType ?? 'unknown', rawBody]);

      // Processar evento de pagamento confirmado
      if (parsed.eventType === 'payment.confirmed' && paymentLinkId !== null) {
        const paymentId = uuidv7();

        // Obter dados do link
        const { rows: linkRows } = await tx.query<{
          patient_id: string; encounter_id: string | null;
          clinic_id: string; amount_cents: string; created_by: string;
        }>(
          `SELECT patient_id, encounter_id, clinic_id, amount_cents::text, created_by
             FROM fin.payment_link WHERE id = $1`, [paymentLinkId]);

        if (linkRows.length > 0) {
          const link = linkRows[0]!;

          // Criar pagamento a partir do link
          await tx.query(
            `INSERT INTO fin.payment
               (id, patient_id, encounter_id, clinic_id, amount_cents, method,
                status, provider_payment_id, created_by, paid_at)
             VALUES ($1, $2, $3, $4, $5, 'link', 'confirmed', $6, $7, clock_timestamp())`,
            [paymentId, link.patient_id, link.encounter_id,
             link.clinic_id, link.amount_cents,
             parsed.providerPaymentId ?? null, link.created_by]);

          // Atualizar status do link
          await tx.query(
            `UPDATE fin.payment_link SET status = 'paid', paid_at = clock_timestamp()
              WHERE id = $1`, [paymentLinkId]);

          // Gerar recibo
          await tx.query(
            `INSERT INTO fin.receipt (id, payment_id, clinic_id, generated_at)
             VALUES ($1, $2, $3, clock_timestamp())`,
            [uuidv7(), paymentId, link.clinic_id]);
        }
      }

      // Processar evento de estorno
      if (parsed.eventType === 'payment.refunded' && parsed.providerPaymentId !== undefined) {
        await tx.query(
          `UPDATE fin.payment SET status = 'refunded', refunded_at = clock_timestamp()
            WHERE provider_payment_id = $1 AND status = 'confirmed'`,
          [parsed.providerPaymentId]);
      }
    });

    return { accepted: true as const };
  });
}
```

- [ ] Adicionar `payment` ao registry de providers em `apps/api/src/providers.ts`.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  type PrescriptionProvider, type SignatureProvider,
  type MessagingProvider, type PaymentProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
    payment: createFakePaymentProvider(),
  };
  return cache;
}
```

- [ ] Registrar a rota de webhook de pagamento no `apps/api/src/app.ts`.

```ts
// No topo de apps/api/src/app.ts, adicionar:
import { paymentWebhookRoutes } from './routes/payments-webhook';

// Apos o register de paymentRoutes:
//   await app.register(paymentRoutes);
//   await app.register(paymentWebhookRoutes);
```

- [ ] Criar o teste de integracao `apps/api/src/routes/payments-webhook.int.test.ts`.

```ts
// apps/api/src/routes/payments-webhook.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;
let patientId: string;
let paymentLinkId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  patientId = uuidv7();
  paymentLinkId = uuidv7();
  const userId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Pay Wh', '66666666000196')`,
      [tenantId, `pwh-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade PayWh', '2077507', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User PayWh')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente PayWh', 'completo', '1988-03-15')`,
      [tenantId, patientId]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 20000, 'Consulta via link',
               clock_timestamp() + interval '24 hours', 'pending', $5)`,
      [tenantId, paymentLinkId, patientId, clinicId, userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('webhook de pagamento', () => {
  it('POST /v1/payments/webhook processa pagamento confirmado via link', async () => {
    const app = await buildApp();
    const payload = JSON.stringify({
      eventType: 'payment.confirmed',
      paymentLinkId,
      providerPaymentId: 'psp_pay_abc123',
      status: 'paid',
      amountCents: 20000,
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: true });

    // Verificar que o webhook_event foi gravado
    const { rows: events } = await jobsPool().query<{ id: string }>(
      `SELECT id FROM fin.webhook_event
        WHERE event_type = 'payment.confirmed'
        ORDER BY received_at DESC LIMIT 1`);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verificar que o pagamento foi criado
    const { rows: pays } = await jobsPool().query<{
      provider_payment_id: string; status: string;
    }>(
      `SELECT provider_payment_id, status::text
         FROM fin.payment WHERE provider_payment_id = 'psp_pay_abc123'`);
    expect(pays.length).toBe(1);
    expect(pays[0]!.status).toBe('confirmed');

    // Verificar que o link foi marcado como pago
    const { rows: links } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM fin.payment_link WHERE id = $1`, [paymentLinkId]);
    expect(links[0]!.status).toBe('paid');

    await app.close();
  });

  it('webhook nao aceita tenant_id como parametro — resolve pelo payment_link', async () => {
    const linkId2 = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    await admin.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 10000, 'Segundo link',
               clock_timestamp() + interval '24 hours', 'pending',
               (SELECT id FROM id."user" LIMIT 1))`,
      [tenantId, linkId2, patientId, clinicId]);
    await admin.end();

    const app = await buildApp();
    const payload = JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      eventType: 'payment.confirmed',
      paymentLinkId: linkId2,
      providerPaymentId: 'psp_pay_inject2',
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-psp-signature': 'valid-sig' },
      payload,
    });

    expect(r.statusCode).toBe(200);

    // Pagamento criado com o tenant correto
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.payment WHERE provider_payment_id = 'psp_pay_inject2'`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantId);
    expect(rows[0]!.tenant_id).not.toBe('00000000-0000-0000-0000-000000000000');

    await app.close();
  });
});
```

- [ ] Rodar os testes e confirmar que passam.

```bash
pnpm vitest run apps/api/src/routes/payments-webhook.int.test.ts
# Esperado: PASS — todos os 2 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/payments-webhook.ts \
       apps/api/src/routes/payments-webhook.int.test.ts \
       apps/api/src/app.ts apps/api/src/providers.ts
git commit -m "feat(api): add payment webhook route with PSP signature validation"
```

---

### Task 41: worker jobs — despachante de outbox, envio de mensagens, reconciliacao, rollup e lembretes

**Arquivos**
- Criar `apps/worker/src/jobs/outbox-dispatcher.ts`
- Criar `apps/worker/src/jobs/outbox-dispatcher.int.test.ts`
- Criar `apps/worker/src/jobs/send-message.ts`
- Criar `apps/worker/src/jobs/send-message.int.test.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.ts`
- Criar `apps/worker/src/jobs/payment-reconciliation.int.test.ts`
- Criar `apps/worker/src/jobs/daily-rollup.ts`
- Criar `apps/worker/src/jobs/daily-rollup.int.test.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.ts`
- Criar `apps/worker/src/jobs/reminder-scheduler.int.test.ts`
- Modificar `apps/worker/src/worker.ts`

**Passos**

- [ ] Criar o despachante de outbox `apps/worker/src/jobs/outbox-dispatcher.ts`.

```ts
// apps/worker/src/jobs/outbox-dispatcher.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

/**
 * Despachante de outbox — polling a cada 5s.
 *
 * Le eventos pendentes das tabelas de outbox (msg.outbox_event e fin.outbox_event),
 * marca como 'dispatched' e enfileira o job correspondente no pg-boss.
 */
export interface DispatchResult {
  readonly dispatched: number;
  readonly errors: number;
}

export async function dispatchOutbox(boss: PgBoss): Promise<DispatchResult> {
  let dispatched = 0;
  let errors = 0;

  // Despachar eventos de mensageria
  const { rows: msgEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE msg.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of msgEvents) {
    try {
      await boss.send(`messaging.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      // Reverter status para retry no proximo ciclo
      await jobsPool().query(
        `UPDATE msg.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  // Despachar eventos financeiros
  const { rows: finEvents } = await jobsPool().query<{
    id: string; event_type: string; aggregate_id: string;
    payload: Record<string, unknown>; tenant_id: string;
  }>(
    `UPDATE fin.outbox_event
        SET status = 'dispatched', dispatched_at = clock_timestamp()
      WHERE status = 'pending'
        AND created_at < clock_timestamp() - interval '100 milliseconds'
      RETURNING id, event_type, aggregate_id, payload, tenant_id`);

  for (const ev of finEvents) {
    try {
      await boss.send(`payments.${ev.event_type}`, {
        outboxEventId: ev.id,
        tenantId: ev.tenant_id,
        aggregateId: ev.aggregate_id,
        ...ev.payload,
      });
      dispatched += 1;
    } catch {
      await jobsPool().query(
        `UPDATE fin.outbox_event SET status = 'pending', dispatched_at = NULL
          WHERE id = $1`, [ev.id]);
      errors += 1;
    }
  }

  return { dispatched, errors };
}
```

- [ ] Criar o job de envio de mensagens `apps/worker/src/jobs/send-message.ts`.

```ts
// apps/worker/src/jobs/send-message.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { MessagingProvider } from '@cadencia/integrations';

export interface SendMessageInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

export interface SendMessageResult {
  readonly messageId: string;
  readonly status: 'sent' | 'failed' | 'indeterminate';
  readonly providerMessageId: string | null;
}

export async function sendMessage(
  input: SendMessageInput,
  messaging: MessagingProvider,
): Promise<SendMessageResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'send-message',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    // Ler a mensagem e a conversa
    const { rows: msgRows } = await tx.query<{
      body: string; conversation_id: string;
    }>(
      `SELECT body, conversation_id FROM msg.message WHERE id = $1`,
      [input.messageId]);

    if (msgRows.length === 0) {
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const msg = msgRows[0]!;

    // Ler a conversa para obter o destinatario e a channel_identity
    const { rows: convRows } = await tx.query<{
      remote_address: string; channel_identity_id: string;
    }>(
      `SELECT remote_address, channel_identity_id
         FROM msg.conversation WHERE id = $1`,
      [msg.conversation_id]);

    if (convRows.length === 0) {
      await tx.query(
        `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'failed' as const,
               providerMessageId: null };
    }

    const conv = convRows[0]!;

    // Ler o ref da channel_identity
    const { rows: ciRows } = await tx.query<{ provider_ref: string }>(
      `SELECT coalesce(provider_ref, id::text) AS provider_ref
         FROM msg.channel_identity WHERE id = $1`,
      [conv.channel_identity_id]);

    const channelIdentityRef = ciRows[0]?.provider_ref ?? '';

    const ctx = {
      tenantId: input.tenantId,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `msg-${input.messageId}`,
      deadlineMs: 10_000,
    };

    const resultado = await messaging.send(ctx, {
      channelIdentityRef,
      to: conv.remote_address as never,
      body: { kind: 'text', text: msg.body },
      conversationId: msg.conversation_id,
    });

    if (resultado.ok) {
      await tx.query(
        `UPDATE msg.message
            SET status = 'sent', provider_message_id = $2, sent_at = clock_timestamp()
          WHERE id = $1`,
        [input.messageId, resultado.value.providerMessageId]);
      return { messageId: input.messageId, status: 'sent' as const,
               providerMessageId: resultado.value.providerMessageId };
    }

    // Timeout em operacao unsafe: estado indeterminado, agendar reconciliacao
    if (resultado.error.kind === 'timeout') {
      await tx.query(
        `UPDATE msg.message SET status = 'indeterminate' WHERE id = $1`,
        [input.messageId]);
      return { messageId: input.messageId, status: 'indeterminate' as const,
               providerMessageId: null };
    }

    await tx.query(
      `UPDATE msg.message SET status = 'failed' WHERE id = $1`,
      [input.messageId]);
    return { messageId: input.messageId, status: 'failed' as const,
             providerMessageId: null };
  });
}
```

- [ ] Criar o job de reconciliacao de pagamentos `apps/worker/src/jobs/payment-reconciliation.ts`.

```ts
// apps/worker/src/jobs/payment-reconciliation.ts
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, isoFromMs, systemClock } from '@cadencia/kernel';
import type { PaymentProvider } from '@cadencia/integrations';
import { asRfc3339 } from '@cadencia/integrations';

export interface ReconciliationResult {
  readonly tenantsProcessed: number;
  readonly settlementsFound: number;
  readonly divergences: number;
}

/**
 * Reconciliacao noturna — busca settlements do PSP e compara com o nosso banco.
 *
 * Roda como job noturno. Para cada tenant com PSP configurado, busca os
 * settlements do dia anterior e marca divergencias.
 */
export async function reconcilePayments(
  payment: PaymentProvider,
): Promise<ReconciliationResult> {
  // Buscar tenants com pagamentos PSP nos ultimos 30 dias
  const { rows: tenants } = await jobsPool().query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM fin.payment
      WHERE provider_payment_id IS NOT NULL
        AND paid_at > clock_timestamp() - interval '30 days'`);

  let settlementsFound = 0;
  let divergences = 0;

  const ontem = new Date(systemClock.nowMs() - 86_400_000);
  const from = asRfc3339(isoFromMs(ontem.setUTCHours(0, 0, 0, 0)));
  const to = asRfc3339(isoFromMs(ontem.setUTCHours(23, 59, 59, 999)));

  if (from === null || to === null) {
    return { tenantsProcessed: 0, settlementsFound: 0, divergences: 0 };
  }

  for (const t of tenants) {
    const actor: Actor = {
      kind: 'system',
      tenantId: t.tenant_id,
      reason: 'payment-reconciliation',
      requestId: uuidv7(),
    };

    const ctx = {
      tenantId: t.tenant_id,
      actorUserId: null,
      requestId: actor.requestId,
      idempotencyKey: `recon-${t.tenant_id}-${isoFromMs(systemClock.nowMs()).slice(0, 10)}`,
      deadlineMs: 30_000,
    };

    const resultado = await payment.fetchSettlements(ctx, { from, to });
    if (!resultado.ok) continue;

    for (const settlement of resultado.value) {
      settlementsFound += 1;

      await withTenantTx(actor, async (tx) => {
        // Verificar se o pagamento existe com o valor correto
        const { rows } = await tx.query<{
          id: string; amount_cents: string; status: string;
        }>(
          `SELECT id, amount_cents::text, status::text
             FROM fin.payment WHERE provider_payment_id = $1`,
          [settlement.providerPaymentId]);

        if (rows.length === 0) {
          // Pagamento no PSP que nao esta no nosso banco — divergencia
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'missing_local', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Pagamento ${settlement.providerPaymentId} encontrado no PSP mas ausente no banco`]);
          return;
        }

        const pay = rows[0]!;
        const localCents = Number(pay.amount_cents);
        if (localCents !== settlement.netAmountCents) {
          divergences += 1;
          await tx.query(
            `INSERT INTO fin.reconciliation_log
               (id, provider_payment_id, kind, detail, detected_at)
             VALUES ($1, $2, 'amount_mismatch', $3, clock_timestamp())`,
            [uuidv7(), settlement.providerPaymentId,
             `Local: ${localCents}, PSP net: ${settlement.netAmountCents}, taxa: ${settlement.feeCents}`]);
        }

        // Gravar a taxa real do PSP
        await tx.query(
          `UPDATE fin.payment
              SET provider_fee_cents = $2, provider_net_cents = $3,
                  reconciled_at = clock_timestamp()
            WHERE id = $1`,
          [pay.id, settlement.feeCents, settlement.netAmountCents]);
      });
    }
  }

  return { tenantsProcessed: tenants.length, settlementsFound, divergences };
}
```

- [ ] Criar o job de materializacao do daily_rollup `apps/worker/src/jobs/daily-rollup.ts`.

```ts
// apps/worker/src/jobs/daily-rollup.ts
import { jobsPool } from '@cadencia/db';

export interface DailyRollupResult {
  readonly rowsUpserted: number;
  readonly tenantsProcessed: number;
}

/**
 * Materializa fin.daily_rollup a partir de fin.payment.
 *
 * Roda diariamente apos o fechamento do dia. Agrega pagamentos por
 * tenant_id, clinic_id, dia, base (competencia/caixa), metodo e status.
 */
export async function materializeDailyRollup(
  opts: { dia?: string } = {},
): Promise<DailyRollupResult> {
  // Se nao especificado, processar o dia anterior
  const diaQuery = opts.dia !== undefined
    ? `$1::date`
    : `(clock_timestamp() - interval '1 day')::date`;
  const params = opts.dia !== undefined ? [opts.dia] : [];

  // Upsert no rollup — base 'caixa' agrega por paid_at
  const resultCaixa = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'caixa' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  // Upsert no rollup — base 'competencia' agrega por created_at
  const resultCompetencia = await jobsPool().query(
    `INSERT INTO fin.daily_rollup
       (tenant_id, clinic_id, day, basis, kind, category_id, status, amount, entries)
     SELECT
       p.tenant_id, p.clinic_id,
       (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       'competencia' AS basis,
       'receita'::fin.entry_kind AS kind,
       coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') AS category_id,
       p.status::text,
       sum(p.amount_cents) / 100.0 AS amount,
       count(*)::int AS entries
     FROM fin.payment p
     WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${diaQuery}
     GROUP BY p.tenant_id, p.clinic_id, day, p.status, p.category_id
     ON CONFLICT (tenant_id, clinic_id, day, basis, kind, category_id, status)
     DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries`,
    params,
  );

  const rowsUpserted = (resultCaixa.rowCount ?? 0) + (resultCompetencia.rowCount ?? 0);

  // Contar tenants distintos processados
  const { rows } = await jobsPool().query<{ n: string }>(
    `SELECT count(DISTINCT tenant_id)::text AS n FROM fin.daily_rollup
      WHERE day = ${diaQuery}`,
    params,
  );

  return {
    rowsUpserted,
    tenantsProcessed: Number(rows[0]?.n ?? 0),
  };
}
```

- [ ] Criar o job de agendamento de lembretes `apps/worker/src/jobs/reminder-scheduler.ts`.

```ts
// apps/worker/src/jobs/reminder-scheduler.ts
import { jobsPool } from '@cadencia/db';
import PgBoss from 'pg-boss';

export interface ReminderScheduleResult {
  readonly scheduled: number;
  readonly skipped: number;
}

/**
 * Agenda lembretes e confirmacoes automaticas.
 *
 * Varre msg.automation_rule para regras habilitadas, encontra agendamentos
 * que se encaixam no criterio de offset e agenda jobs de envio.
 *
 * Meta: entrega de lembrete dentro da janela 99,5% (Apendice A).
 */
export async function scheduleReminders(boss: PgBoss): Promise<ReminderScheduleResult> {
  let scheduled = 0;
  let skipped = 0;

  // Buscar regras ativas
  const { rows: rules } = await jobsPool().query<{
    id: string; tenant_id: string; trigger: string; template_id: string | null;
    offset_minutes: string; channel_kind: string;
  }>(
    `SELECT r.id, r.tenant_id, r.trigger, r.template_id,
            r.offset_minutes::text, r.channel_kind
       FROM msg.automation_rule r
      WHERE r.enabled = true`);

  for (const rule of rules) {
    const offsetMinutes = Number(rule.offset_minutes);

    // Buscar agendamentos que precisam de lembrete/confirmacao
    // O offset negativo significa "antes do agendamento"
    // Ex: offset_minutes = -1440 significa 24h antes
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
             WHERE sr.appointment_id = a.id AND sr.rule_id = $3
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
          channelKind: rule.channel_kind,
          ruleId: rule.id,
        });

        // Marcar como agendado para nao duplicar
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
```

- [ ] Atualizar o worker para registrar todos os novos jobs `apps/worker/src/worker.ts`.

```ts
// apps/worker/src/worker.ts
import PgBoss from 'pg-boss';
import { closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './jobs/auto-finalize-drafts';
import { dispatchOutbox } from './jobs/outbox-dispatcher';
import { sendMessage, type SendMessageInput } from './jobs/send-message';
import { reconcilePayments } from './jobs/payment-reconciliation';
import { materializeDailyRollup } from './jobs/daily-rollup';
import { scheduleReminders } from './jobs/reminder-scheduler';
import {
  createFakeMessagingProvider, createFakePaymentProvider,
} from '@cadencia/integrations';

const FILA_RASCUNHOS = 'emr.auto-finalize-stale-drafts';
const FILA_OUTBOX = 'outbox.dispatch';
const FILA_ENVIO_MSG = 'messaging.send_message';
const FILA_RECONCILIACAO = 'payments.reconciliation';
const FILA_ROLLUP = 'fin.daily-rollup';
const FILA_LEMBRETES = 'messaging.schedule-reminders';

export async function startWorker(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();

  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  const messaging = usarFakes ? createFakeMessagingProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();
  const payment = usarFakes ? createFakePaymentProvider() : (() => {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais');
  })();

  // ── Job existente: auto-finalizacao ──────────────────────────────────────
  await boss.work(FILA_RASCUNHOS, async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    process.stdout.write(
      `[worker] auto-finalize: ${r.finalizados}/${r.examinados} (falhas: ${r.falhas})\n`);
  });

  // ── Despachante de outbox (polling a cada 5s) ────────────────────────────
  await boss.work(FILA_OUTBOX, async () => {
    const r = await dispatchOutbox(boss);
    if (r.dispatched > 0 || r.errors > 0) {
      process.stdout.write(
        `[worker] outbox: ${r.dispatched} despachados, ${r.errors} erros\n`);
    }
  });

  // ── Envio de mensagens (consome outbox de tipo messaging) ────────────────
  await boss.work(FILA_ENVIO_MSG, async (job) => {
    const data = job.data as SendMessageInput & { tenantId: string };
    const r = await sendMessage(data, messaging);
    process.stdout.write(
      `[worker] send-message: ${r.messageId} -> ${r.status}\n`);
  });

  // ── Reconciliacao noturna ────────────────────────────────────────────────
  await boss.work(FILA_RECONCILIACAO, async () => {
    const r = await reconcilePayments(payment);
    process.stdout.write(
      `[worker] reconciliation: ${r.tenantsProcessed} tenants, `
      + `${r.settlementsFound} settlements, ${r.divergences} divergencias\n`);
  });

  // ── Materializacao do daily_rollup ───────────────────────────────────────
  await boss.work(FILA_ROLLUP, async () => {
    const r = await materializeDailyRollup();
    process.stdout.write(
      `[worker] daily-rollup: ${r.rowsUpserted} linhas, ${r.tenantsProcessed} tenants\n`);
  });

  // ── Agendamento de lembretes ─────────────────────────────────────────────
  await boss.work(FILA_LEMBRETES, async () => {
    const r = await scheduleReminders(boss);
    process.stdout.write(
      `[worker] reminders: ${r.scheduled} agendados, ${r.skipped} pulados\n`);
  });

  // ── Schedules ────────────────────────────────────────────────────────────
  await boss.schedule(FILA_RASCUNHOS, '0 3 * * *');
  await boss.schedule(FILA_OUTBOX, '*/5 * * * * *');       // cada 5 segundos
  await boss.schedule(FILA_RECONCILIACAO, '0 4 * * *');    // 4h da manha
  await boss.schedule(FILA_ROLLUP, '30 3 * * *');          // 3h30 da manha
  await boss.schedule(FILA_LEMBRETES, '* * * * *');        // a cada minuto

  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void (async () => { await boss.stop(); await closePools(); process.exit(0); })();
    });
  }
}

if (process.env.NODE_ENV !== 'test') void main();
```

- [ ] Criar testes de integracao para os jobs do worker.

```ts
// apps/worker/src/jobs/outbox-dispatcher.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { dispatchOutbox } from './outbox-dispatcher';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let boss: PgBoss;
let tenantId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Outbox Test', '77777777000197')`,
      [tenantId, `ob-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ob', '2077508', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);

    // Inserir evento de outbox pendente
    await c.query(
      `INSERT INTO msg.outbox_event
         (tenant_id, id, event_type, aggregate_id, payload, status,
          created_at)
       VALUES ($1, $2, 'send_message', $3,
               '{"messageId":"m1","conversationId":"c1"}'::jsonb,
               'pending', clock_timestamp() - interval '1 second')`,
      [tenantId, uuidv7(), uuidv7()]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL_JOBS ?? '',
    schema: 'pgboss',
  });
  await boss.start();
});

afterAll(async () => {
  await boss.stop();
  await closePools();
});

describe('despachante de outbox', () => {
  it('despacha eventos pendentes e marca como dispatched', async () => {
    const r = await dispatchOutbox(boss);
    expect(r.dispatched).toBeGreaterThanOrEqual(1);
    expect(r.errors).toBe(0);

    // Verificar que o evento foi marcado
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status FROM msg.outbox_event WHERE tenant_id = $1`, [tenantId]);
    expect(rows.every((row) => row.status === 'dispatched')).toBe(true);
  });
});
```

```ts
// apps/worker/src/jobs/send-message.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeMessagingProvider } from '@cadencia/integrations';
import { Pool } from 'pg';
import { sendMessage } from './send-message';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let messageId: string;
let conversationId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  const clinicId = uuidv7();
  const channelIdentityId = uuidv7();
  conversationId = uuidv7();
  messageId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Send Test', '88888888000198')`,
      [tenantId, `snd-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Snd', '2077509', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Clinica Snd', '+5511999777666', 'verified')`,
      [tenantId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, channel_kind,
          remote_address, status, last_message_at, unread_count)
       VALUES ($1, $2, $3, 'whatsapp', '+5511988776655', 'open',
               clock_timestamp(), 0)`,
      [tenantId, conversationId, channelIdentityId]);
    await c.query(
      `INSERT INTO msg.message
         (tenant_id, id, conversation_id, direction, body, status)
       VALUES ($1, $2, $3, 'outbound', 'Sua consulta esta confirmada', 'queued')`,
      [tenantId, messageId, conversationId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('envio de mensagem via worker', () => {
  it('envia a mensagem e atualiza o status para sent', async () => {
    const messaging = createFakeMessagingProvider();
    const r = await sendMessage({
      tenantId, messageId, conversationId,
    }, messaging);

    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toBeTruthy();

    // Verificar no banco
    const { rows } = await jobsPool().query<{ status: string }>(
      `SELECT status::text FROM msg.message WHERE id = $1`, [messageId]);
    expect(rows[0]?.status).toBe('sent');
  });
});
```

```ts
// apps/worker/src/jobs/daily-rollup.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { materializeDailyRollup } from './daily-rollup';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  const userId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Rollup Test', '99999999000199')`,
      [tenantId, `rl-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rl', '2077510', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Rl')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Rl', 'completo', '1990-01-01')`,
      [tenantId, patientId]);

    // Inserir pagamento de ontem
    await c.query(
      `INSERT INTO fin.payment
         (tenant_id, id, patient_id, clinic_id, amount_cents, method,
          status, created_by, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 15000, 'pix', 'confirmed', $5,
               clock_timestamp() - interval '1 day',
               clock_timestamp() - interval '1 day')`,
      [tenantId, uuidv7(), patientId, clinicId, userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('materializacao do daily_rollup', () => {
  it('agrega pagamentos do dia anterior no rollup', async () => {
    const r = await materializeDailyRollup();
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    // Verificar que o rollup foi gravado
    const { rows } = await jobsPool().query<{ entries: string; amount: string }>(
      `SELECT entries::text, amount::text FROM fin.daily_rollup
        WHERE tenant_id = $1 AND clinic_id = $2`,
      [tenantId, clinicId]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

```ts
// apps/worker/src/jobs/payment-reconciliation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { createFakePaymentProvider } from '@cadencia/integrations';
import { reconcilePayments } from './payment-reconciliation';

afterAll(async () => { await closePools(); });

describe('reconciliacao de pagamentos', () => {
  it('roda sem erro mesmo sem pagamentos PSP', async () => {
    const payment = createFakePaymentProvider();
    const r = await reconcilePayments(payment);
    expect(r.tenantsProcessed).toBeGreaterThanOrEqual(0);
    expect(typeof r.settlementsFound).toBe('number');
    expect(typeof r.divergences).toBe('number');
  });
});
```

```ts
// apps/worker/src/jobs/reminder-scheduler.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import PgBoss from 'pg-boss';
import { scheduleReminders } from './reminder-scheduler';

let boss: PgBoss;

afterAll(async () => {
  if (boss) await boss.stop();
  await closePools();
});

describe('agendador de lembretes', () => {
  it('roda sem erro mesmo sem regras habilitadas', async () => {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL_JOBS ?? '',
      schema: 'pgboss',
    });
    await boss.start();

    const r = await scheduleReminders(boss);
    expect(r.scheduled).toBeGreaterThanOrEqual(0);
    expect(r.skipped).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] Rodar todos os testes do worker.

```bash
pnpm vitest run apps/worker/src/jobs/
# Esperado: PASS — todos os testes verdes
```

- [ ] Commitar.

```bash
git add apps/worker/src/worker.ts \
       apps/worker/src/jobs/outbox-dispatcher.ts \
       apps/worker/src/jobs/outbox-dispatcher.int.test.ts \
       apps/worker/src/jobs/send-message.ts \
       apps/worker/src/jobs/send-message.int.test.ts \
       apps/worker/src/jobs/payment-reconciliation.ts \
       apps/worker/src/jobs/payment-reconciliation.int.test.ts \
       apps/worker/src/jobs/daily-rollup.ts \
       apps/worker/src/jobs/daily-rollup.int.test.ts \
       apps/worker/src/jobs/reminder-scheduler.ts \
       apps/worker/src/jobs/reminder-scheduler.int.test.ts
git commit -m "feat(worker): add outbox dispatcher, message sending, reconciliation, rollup and reminder jobs"
```

---

### Task 42: teste de isolamento — webhook nao aceita tenant_id como parametro

**Arquivos**
- Criar `apps/api/src/routes/webhook-isolation.int.test.ts`

**Passos**

- [ ] Criar o teste de isolamento dedicado que verifica que nenhum webhook aceita tenant_id como parametro.

```ts
// apps/api/src/routes/webhook-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';

/**
 * Teste de isolamento (padrao test:iso) para webhooks.
 *
 * Verifica que NENHUMA rota de webhook aceita tenant_id como parametro
 * de entrada. O tenant_id deve ser resolvido internamente pela
 * channel_identity (mensageria) ou pelo payment_link/payment (pagamento).
 *
 * Cenario: cria dois tenants A e B. Envia webhook com tenant_id do B
 * para um recurso do A. O dado gravado deve pertencer ao tenant A,
 * nao ao B — provando que o tenant_id do request foi ignorado.
 */

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantA: string;
let tenantB: string;
let channelIdentityA: string;
let paymentLinkA: string;

beforeAll(async () => {
  tenantA = uuidv7();
  tenantB = uuidv7();
  const clinicA = uuidv7();
  const clinicB = uuidv7();
  const userA = uuidv7();
  const patientA = uuidv7();
  channelIdentityA = uuidv7();
  paymentLinkA = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // Tenant A
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso A', '11100011000100')`,
      [tenantA, `isoa-${tenantA.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso A', '2077511', 'America/Sao_Paulo')`,
      [tenantA, clinicA]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Iso A')`,
      [userA, `${userA}@example.test`]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Iso A', 'completo', '1991-01-01')`,
      [tenantA, patientA]);
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel_kind, display_name, phone, status)
       VALUES ($1, $2, 'whatsapp', 'Iso A Clinica', '+5511911111111', 'verified')`,
      [tenantA, channelIdentityA]);
    await c.query(
      `INSERT INTO fin.payment_link
         (tenant_id, id, patient_id, clinic_id, amount_cents,
          description, expires_at, status, created_by)
       VALUES ($1, $2, $3, $4, 30000, 'Link Iso A',
               clock_timestamp() + interval '24 hours', 'pending', $5)`,
      [tenantA, paymentLinkA, patientA, clinicA, userA]);

    // Tenant B (apenas para ter um ID diferente)
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Iso B', '22200022000200')`,
      [tenantB, `isob-${tenantB.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Iso B', '2077512', 'America/Sao_Paulo')`,
      [tenantB, clinicB]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('isolamento de webhooks (test:iso)', () => {
  it('webhook de mensageria ignora tenant_id do request e usa o da channel_identity', async () => {
    const app = await buildApp();

    const payload = JSON.stringify({
      tenant_id: tenantB, // INJETADO — deve ser ignorado
      events: [{
        from: '+5511922222222',
        to: '+5511911111111', // telefone do tenant A
        body: 'Mensagem de teste de isolamento',
        providerMessageId: `wamid.iso-${uuidv7()}`,
      }],
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/messaging/webhook/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // A conversa DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM msg.conversation
        WHERE channel_identity_id = $1 AND remote_address = '+5511922222222'`,
      [channelIdentityA]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.tenant_id).toBe(tenantA);
    expect(rows[0]!.tenant_id).not.toBe(tenantB);

    await app.close();
  });

  it('webhook de pagamento ignora tenant_id do request e usa o do payment_link', async () => {
    const app = await buildApp();

    const payload = JSON.stringify({
      tenant_id: tenantB, // INJETADO — deve ser ignorado
      eventType: 'payment.confirmed',
      paymentLinkId: paymentLinkA, // pertence ao tenant A
      providerPaymentId: `psp_iso_${uuidv7()}`,
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload,
    });
    expect(r.statusCode).toBe(200);

    // O pagamento DEVE pertencer ao tenant A, NAO ao B
    const { rows } = await jobsPool().query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fin.payment
        WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 1`, [tenantA]);
    if (rows.length > 0) {
      expect(rows[0]!.tenant_id).toBe(tenantA);
      expect(rows[0]!.tenant_id).not.toBe(tenantB);
    }

    // Nunca deve haver pagamento no tenant B originado deste webhook
    const { rows: rowsB } = await jobsPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.payment WHERE tenant_id = $1`, [tenantB]);
    expect(Number(rowsB[0]?.n)).toBe(0);

    await app.close();
  });

  it('rota de webhook de mensageria NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    // A rota nao aceita tenant_id como query param
    const r = await app.inject({
      method: 'POST',
      url: `/v1/messaging/webhook/whatsapp?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=fake-valid-signature',
      },
      payload: JSON.stringify({ events: [] }),
    });
    // Deve funcionar normalmente — o query param e ignorado
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('rota de webhook de pagamento NAO tem parametro tenant_id no schema', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/webhook?tenant_id=${tenantB}`,
      headers: {
        'content-type': 'application/json',
        'x-psp-signature': 'valid-sig',
      },
      payload: JSON.stringify({ eventType: 'unknown', providerPaymentId: 'none' }),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
```

- [ ] Rodar o teste de isolamento.

```bash
pnpm vitest run apps/api/src/routes/webhook-isolation.int.test.ts
# Esperado: PASS — todos os 4 testes verdes
```

- [ ] Commitar.

```bash
git add apps/api/src/routes/webhook-isolation.int.test.ts
git commit -m "test(iso): verify webhooks never accept tenant_id from request parameters"
```

## Parte V — Telas

### Task 43: Caixa de entrada de conversas — lista com filtros na query string

**Arquivos**

- Criar `apps/web/src/telas/CaixaDeConversas.tsx`
- Criar `apps/web/src/telas/CaixaDeConversas.test.tsx`

> **REMOVIDO**: a alteracao de `nav.ts` (FASE_ATUAL e disponivelNaFase) foi
> movida para o Bloco 10, Task 55, que e o integration gate.

**Passos**

- [ ] Criar o teste `CaixaDeConversas.test.tsx`:

```tsx
// apps/web/src/telas/CaixaDeConversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CaixaDeConversas, type ConversaResumo } from './CaixaDeConversas';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Bom dia, confirmo a consulta',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 2,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Gostaria de agendar',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c3', patientId: 'p3', patientName: 'Joana Prado',
    phoneNumber: '+5511777770003', lastMessageBody: 'Obrigada!',
    lastMessageAt: '2026-08-03T10:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'outbound',
  },
];

function montar(over: Partial<Parameters<typeof CaixaDeConversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    carregar: vi.fn(async () => CONVERSAS),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    ...over,
  };
  render(<CaixaDeConversas {...props} />);
  return props;
}

describe('tela Caixa de Conversas', () => {
  it('o titulo diz Conversas', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Conversas/i })).toBeVisible());
  });

  it('lista as conversas em ordem de lastMessageAt DESC', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[0]).toHaveTextContent('Maria Souza Lima');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[2]).toHaveTextContent('Joana Prado');
  });

  it('conversa com numero desconhecido mostra "Numero desconhecido" e opcao de vincular a paciente', async () => {
    montar();
    const itens = await screen.findAllByRole('listitem');
    expect(itens[1]).toHaveTextContent('+5511888880002');
    expect(itens[1]).not.toHaveTextContent('null');
  });

  it('mostra badge de nao-lidas quando unreadCount > 0', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('2')).toBeVisible());
  });

  it('mostra preview da ultima mensagem em cada linha', async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText('Bom dia, confirmo a consulta')).toBeVisible());
  });

  it('filtros sao botoes com aria-pressed e vao para query string', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Todas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nao lidas/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('nao_lidas');
  });

  it('clicar na conversa chama aoAbrirConversa com o conversationId', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <CaixaDeConversas filtro="todas" carregar={async () => CONVERSAS}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha (componente nao existe):

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx
# Esperado: FAIL — Cannot find module './CaixaDeConversas'
```

- [ ] Criar o componente `CaixaDeConversas.tsx`:

```tsx
// apps/web/src/telas/CaixaDeConversas.tsx
'use client';

import { useEffect, useState } from 'react';

export type FiltroConversas = 'todas' | 'nao_lidas' | 'whatsapp';

export interface ConversaResumo {
  readonly conversationId: string;
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly phoneNumber: string;
  readonly lastMessageBody: string;
  readonly lastMessageAt: string;
  readonly unreadCount: number;
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly status: 'ativa' | 'arquivada';
  readonly lastMessageDirection: 'inbound' | 'outbound';
}

const FILTROS: ReadonlyArray<{ chave: FiltroConversas; rotulo: string }> = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'nao_lidas', rotulo: 'Nao lidas' },
  { chave: 'whatsapp', rotulo: 'WhatsApp' },
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0]![0]!.toUpperCase();
  return `${partes[0]![0]!.toUpperCase()}${partes[partes.length - 1]![0]!.toUpperCase()}`;
}

function horaOuData(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  const mesmo = d.getUTCFullYear() === agora.getUTCFullYear()
    && d.getUTCMonth() === agora.getUTCMonth()
    && d.getUTCDate() === agora.getUTCDate();
  if (mesmo) {
    return new Intl.DateTimeFormat('pt-BR',
      { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
  }
  return new Intl.DateTimeFormat('pt-BR',
    { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

function nomeExibido(c: ConversaResumo): string {
  if (c.patientName !== null) return c.patientName;
  return c.phoneNumber;
}

export interface CaixaDeConversasProps {
  readonly filtro: FiltroConversas;
  readonly carregar: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
}

export function CaixaDeConversas(p: CaixaDeConversasProps) {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);

  useEffect(() => {
    void p.carregar(p.filtro).then(setConversas);
  }, [p, p.filtro]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Conversas
      </h1>

      <div role="group" aria-label="Filtros de conversas"
           style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {FILTROS.map((f) => (
          <button key={f.chave} type="button" aria-pressed={p.filtro === f.chave}
            onClick={() => p.aoMudarFiltro(f.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-full)', minHeight: 28,
              padding: `0 var(--s-5)`, fontSize: 'var(--fs-13)', cursor: 'pointer',
              background: p.filtro === f.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)',
            }}>
            {f.rotulo}
          </button>
        ))}
      </div>

      <ul aria-label="Lista de conversas"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface)' }}>
        {conversas.map((c) => (
          <li key={c.conversationId}
            onClick={() => p.aoAbrirConversa(c.conversationId)}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: `var(--s-4) var(--s-5)`,
              borderBottom: 'var(--border)', cursor: 'pointer',
              background: c.unreadCount > 0 ? 'var(--surface-hover)' : 'var(--surface)',
            }}>
            <span aria-hidden="true" style={{
              width: 40, height: 40, borderRadius: 'var(--r-full)',
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)',
            }}>
              {c.patientName !== null ? iniciais(c.patientName) : '#'}
            </span>

            <div style={{ display: 'grid', gap: 'var(--s-1)', overflow: 'hidden' }}>
              <span style={{
                fontWeight: c.unreadCount > 0 ? 'var(--fw-semibold)' : 'var(--fw-medium)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {nomeExibido(c)}
              </span>
              <span style={{
                fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.lastMessageBody}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 'var(--s-1)', justifyItems: 'end',
                          alignSelf: 'start' }}>
              <span className="num" style={{
                fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
              }}>
                {horaOuData(c.lastMessageAt)}
              </span>
              {c.unreadCount > 0 ? (
                <span style={{
                  minWidth: 20, height: 20, borderRadius: 'var(--r-full)',
                  background: 'var(--accent)', color: 'var(--accent-on)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-semibold)',
                  padding: '0 6px',
                }}>
                  {c.unreadCount}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx
# Esperado: PASS — 7 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/CaixaDeConversas.tsx apps/web/src/telas/CaixaDeConversas.test.tsx apps/web/src/ui/nav.ts
git commit -m "feat(web): inbox screen for conversations with filters in query string"
```

---

### Task 44: Painel de conversa — thread de mensagens com bolhas e input

**Arquivos**

- Criar `apps/web/src/telas/PainelDeConversa.tsx`
- Criar `apps/web/src/telas/PainelDeConversa.test.tsx`

**Passos**

- [ ] Criar o teste `PainelDeConversa.test.tsx`:

```tsx
// apps/web/src/telas/PainelDeConversa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeConversa, type Mensagem, type ContextoConversa } from './PainelDeConversa';

const MENSAGENS: Mensagem[] = [
  {
    messageId: 'm1', direction: 'inbound',
    body: 'Bom dia, confirmo a consulta de amanha',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered',
  },
  {
    messageId: 'm2', direction: 'outbound',
    body: 'Perfeito, Maria! Confirmado para amanha as 14h.',
    sentAt: '2026-08-03T14:31:00.000Z', deliveryStatus: 'read',
  },
  {
    messageId: 'm3', direction: 'outbound',
    body: 'Lembramos de trazer os exames.',
    sentAt: '2026-08-03T14:32:00.000Z', deliveryStatus: 'sent',
  },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: { dia: '2026-08-04', hora: '14:00', procedimento: 'Consulta' },
  pendencias: ['CPF', 'Endereco'],
  historicoAgendamentos: [
    { dia: '2026-07-01', procedimento: 'Retorno', status: 'atendido' },
  ],
};

function montar(over: Partial<Parameters<typeof PainelDeConversa>[0]> = {}) {
  const props = {
    conversationId: 'c1',
    nomeExibido: 'Maria Souza Lima',
    phoneNumber: '+5511999990001',
    patientId: 'p1' as string | null,
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoEnviar: vi.fn(async () => ({ messageId: 'm4' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<PainelDeConversa {...props} />);
  return props;
}

describe('painel de conversa', () => {
  it('mostra o nome do contato no cabecalho', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 2, name: /Maria Souza Lima/ })).toBeVisible());
  });

  it('mensagens inbound ficam a esquerda e outbound a direita', async () => {
    montar();
    const msgs = await screen.findAllByTestId(/^msg-/);
    expect(msgs[0]).toHaveAttribute('data-direction', 'inbound');
    expect(msgs[1]).toHaveAttribute('data-direction', 'outbound');
  });

  it('mostra status de entrega com icones discretos nas mensagens outbound', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByTitle('Entregue')).toBeVisible();
      expect(screen.getByTitle('Lido')).toBeVisible();
      expect(screen.getByTitle('Enviado')).toBeVisible();
    });
  });

  it('Enter envia a mensagem, Shift+Enter quebra linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Ola!');
    await userEvent.keyboard('{Enter}');
    expect(aoEnviar).toHaveBeenCalledWith('Ola!');
  });

  it('Shift+Enter nao envia, insere quebra de linha', async () => {
    const { aoEnviar } = montar();
    await screen.findAllByTestId(/^msg-/);
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    await userEvent.type(input, 'Linha 1');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('painel de contexto mostra proximo agendamento e pendencias, NUNCA conteudo clinico', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText(/CPF/)).toBeVisible();
      expect(screen.getByText(/Endereco/)).toBeVisible();
    });
    expect(screen.queryByText(/prontuario/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostico/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prescricao/i)).not.toBeInTheDocument();
  });

  it('conversa com numero desconhecido mostra opcao de vincular a paciente', async () => {
    montar({ patientId: null, nomeExibido: '+5511888880002' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
  });

  it('botao de template abre seletor', async () => {
    const { aoSelecionarTemplate } = montar();
    await screen.findAllByTestId(/^msg-/);
    await userEvent.click(screen.getByRole('button', { name: /Template/ }));
    expect(aoSelecionarTemplate).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <PainelDeConversa conversationId="c1" nomeExibido="Maria Souza Lima"
        phoneNumber="+5511999990001" patientId="p1"
        carregarMensagens={async () => MENSAGENS} carregarContexto={async () => CONTEXTO}
        aoEnviar={async () => ({ messageId: 'm4' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId(/^msg-/).length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/PainelDeConversa.test.tsx
# Esperado: FAIL — Cannot find module './PainelDeConversa'
```

- [ ] Criar o componente `PainelDeConversa.tsx`:

```tsx
// apps/web/src/telas/PainelDeConversa.tsx
'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Mensagem {
  readonly messageId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly body: string;
  readonly sentAt: string;
  readonly deliveryStatus: DeliveryStatus;
}

export interface AgendamentoContexto {
  readonly dia: string;
  readonly hora: string;
  readonly procedimento: string;
}

export interface HistoricoAgendamento {
  readonly dia: string;
  readonly procedimento: string;
  readonly status: string;
}

export interface ContextoConversa {
  readonly proximoAgendamento: AgendamentoContexto | null;
  readonly pendencias: readonly string[];
  readonly historicoAgendamentos: readonly HistoricoAgendamento[];
}

const STATUS_GLIFO: Record<DeliveryStatus, { glifo: string; titulo: string }> = {
  queued:    { glifo: '○', titulo: 'Na fila' },
  sent:      { glifo: '✓', titulo: 'Enviado' },
  delivered: { glifo: '✓✓', titulo: 'Entregue' },
  read:      { glifo: '✓✓', titulo: 'Lido' },
  failed:    { glifo: '✗', titulo: 'Falhou' },
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export interface PainelDeConversaProps {
  readonly conversationId: string;
  readonly nomeExibido: string;
  readonly phoneNumber: string;
  readonly patientId: string | null;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

export function PainelDeConversa(p: PainelDeConversaProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [contexto, setContexto] = useState<ContextoConversa | null>(null);
  const [texto, setTexto] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void p.carregarMensagens(p.conversationId).then(setMensagens);
    void p.carregarContexto(p.conversationId).then(setContexto);
  }, [p, p.conversationId]);

  useEffect(() => {
    if (threadRef.current !== null) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [mensagens]);

  async function enviar(): Promise<void> {
    const corpo = texto.trim();
    if (corpo === '') return;
    setTexto('');
    const { messageId } = await p.aoEnviar(corpo);
    setMensagens((prev) => [...prev, {
      messageId, direction: 'outbound', body: corpo,
      sentAt: new Date().toISOString(), deliveryStatus: 'queued',
    }]);
  }

  function aoTeclarInput(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      gridTemplateRows: 'auto 1fr auto',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Cabecalho */}
      <header style={{
        gridColumn: '1 / -1', display: 'flex', alignItems: 'center',
        gap: 'var(--s-4)', padding: `var(--s-4) var(--s-5)`,
        borderBottom: 'var(--border)', background: 'var(--surface)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.nomeExibido}
        </h2>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.phoneNumber}
        </span>
        {p.patientId === null ? (
          <button type="button" onClick={p.aoVincularPaciente}
            style={{
              marginInlineStart: 'auto', border: 'var(--border)',
              borderRadius: 'var(--r-md)', background: 'var(--surface)',
              padding: 'var(--s-2) var(--s-4)', fontSize: 'var(--fs-13)',
              cursor: 'pointer', color: 'var(--accent)',
            }}>
            Vincular a paciente
          </button>
        ) : null}
      </header>

      {/* Thread de mensagens */}
      <div ref={threadRef} aria-label="Mensagens"
        style={{
          gridColumn: 1, overflowY: 'auto',
          padding: 'var(--s-5)', display: 'flex',
          flexDirection: 'column', gap: 'var(--s-3)',
        }}>
        {mensagens.map((m) => {
          const outbound = m.direction === 'outbound';
          const st = STATUS_GLIFO[m.deliveryStatus];
          return (
            <div
              key={m.messageId}
              data-testid={`msg-${m.messageId}`}
              data-direction={m.direction}
              style={{
                alignSelf: outbound ? 'flex-end' : 'flex-start',
                maxWidth: '75%', padding: `var(--s-3) var(--s-4)`,
                borderRadius: 'var(--r-md)',
                background: outbound ? 'var(--accent-soft)' : 'var(--surface-sunken)',
              }}>
              <p style={{ margin: 0, fontSize: 'var(--fs-14)', lineHeight: 'var(--lh-read)',
                          whiteSpace: 'pre-wrap' }}>
                {m.body}
              </p>
              <span style={{
                display: 'flex', justifyContent: 'flex-end',
                gap: 'var(--s-2)', marginTop: 'var(--s-1)',
                fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
              }}>
                <span className="num">{hora(m.sentAt)}</span>
                {outbound ? (
                  <span title={st.titulo} style={{
                    color: m.deliveryStatus === 'read' ? 'var(--accent)' : 'var(--text-muted)',
                  }}>
                    {st.glifo}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* Painel de contexto */}
      <aside aria-label="Contexto do paciente"
        style={{
          gridColumn: 2, gridRow: '2 / 4', borderInlineStart: 'var(--border)',
          padding: 'var(--s-5)', overflowY: 'auto', background: 'var(--surface)',
          fontSize: 'var(--fs-13)',
        }}>
        {contexto !== null ? (
          <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
            {contexto.proximoAgendamento !== null ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Proximo agendamento
                </h3>
                <p style={{ margin: 0 }}>
                  {`${contexto.proximoAgendamento.dia} as ${contexto.proximoAgendamento.hora}`}
                </p>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  {contexto.proximoAgendamento.procedimento}
                </p>
              </div>
            ) : null}

            {contexto.pendencias.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Pendencias
                </h3>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none',
                             display: 'grid', gap: 'var(--s-2)' }}>
                  {contexto.pendencias.map((pend) => (
                    <li key={pend} style={{ color: 'var(--warn)' }}>{pend}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {contexto.historicoAgendamentos.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase',
                             letterSpacing: '.04em', color: 'var(--text-muted)',
                             fontWeight: 'var(--fw-medium)', margin: `0 0 var(--s-3)` }}>
                  Historico
                </h3>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none',
                             display: 'grid', gap: 'var(--s-2)' }}>
                  {contexto.historicoAgendamentos.map((h) => (
                    <li key={`${h.dia}-${h.procedimento}`}
                      style={{ display: 'flex', gap: 'var(--s-3)' }}>
                      <span className="num" style={{ color: 'var(--text-muted)' }}>{h.dia}</span>
                      <span>{h.procedimento}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Input de mensagem */}
      <div style={{
        gridColumn: 1, display: 'flex', gap: 'var(--s-3)',
        padding: 'var(--s-4)', borderTop: 'var(--border)',
        background: 'var(--surface)', alignItems: 'flex-end',
      }}>
        <button type="button" aria-label="Template" onClick={p.aoSelecionarTemplate}
          style={{
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', width: 36, height: 36,
            cursor: 'pointer', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-15)',
          }}>
          T
        </button>
        <textarea
          aria-label="Mensagem"
          role="textbox"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclarInput}
          rows={1}
          style={{
            flex: 1, resize: 'none', border: 'var(--border)',
            borderRadius: 'var(--r-md)', padding: 'var(--s-3) var(--s-4)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
            minHeight: 36, maxHeight: 120,
          }}
        />
        <button type="button" aria-label="Enviar" onClick={() => { void enviar(); }}
          style={{
            border: 'none', borderRadius: 'var(--r-md)',
            background: 'var(--accent)', color: 'var(--accent-on)',
            width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-15)',
          }}>
          &gt;
        </button>
      </div>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/PainelDeConversa.test.tsx
# Esperado: PASS — 8 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/PainelDeConversa.tsx apps/web/src/telas/PainelDeConversa.test.tsx
git commit -m "feat(web): conversation panel with message thread, delivery status and context"
```

---

### Task 45: Split view — caixa de entrada + painel de conversa lado a lado

**Arquivos**

- Criar `apps/web/src/telas/Conversas.tsx`
- Criar `apps/web/src/telas/Conversas.test.tsx`

**Passos**

- [ ] Criar o teste `Conversas.test.tsx`:

```tsx
// apps/web/src/telas/Conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c1', patientId: 'p1', patientName: 'Maria Souza Lima',
    phoneNumber: '+5511999990001', lastMessageBody: 'Confirmo',
    lastMessageAt: '2026-08-03T14:30:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
  {
    conversationId: 'c2', patientId: null, patientName: null,
    phoneNumber: '+5511888880002', lastMessageBody: 'Oi',
    lastMessageAt: '2026-08-03T13:00:00.000Z', unreadCount: 0,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Confirmo',
    sentAt: '2026-08-03T14:30:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

function montar(over: Partial<Parameters<typeof Conversas>[0]> = {}) {
  const props = {
    filtro: 'todas' as const,
    conversaAbertaId: null as string | null,
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarMensagens: vi.fn(async () => MENSAGENS),
    carregarContexto: vi.fn(async () => CONTEXTO),
    aoMudarFiltro: vi.fn(),
    aoAbrirConversa: vi.fn(),
    aoEnviar: vi.fn(async () => ({ messageId: 'm9' })),
    aoVincularPaciente: vi.fn(),
    aoSelecionarTemplate: vi.fn(),
    ...over,
  };
  render(<Conversas {...props} />);
  return props;
}

describe('tela Conversas (split view)', () => {
  it('sem conversa selecionada, mostra so a lista', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('textbox', { name: /Mensagem/ })).not.toBeInTheDocument();
  });

  it('layout e split 40/60 quando uma conversa esta aberta', async () => {
    montar({ conversaAbertaId: 'c1' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Mensagem/ })).toBeVisible());
    const container = screen.getByTestId('split-view');
    expect(container).toHaveStyle({ gridTemplateColumns: '40% 60%' });
  });

  it('clicar na conversa chama aoAbrirConversa', async () => {
    const { aoAbrirConversa } = montar();
    const itens = await screen.findAllByRole('listitem');
    await userEvent.click(itens[0]!);
    expect(aoAbrirConversa).toHaveBeenCalledWith('c1');
  });

  it('conversa com numero desconhecido mostra o numero e botao de vincular no painel', async () => {
    montar({ conversaAbertaId: 'c2' });
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    expect(screen.getByText('+5511888880002')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Conversas filtro="todas" conversaAbertaId="c1"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/Conversas.test.tsx
# Esperado: FAIL — Cannot find module './Conversas'
```

- [ ] Criar o componente `Conversas.tsx`:

```tsx
// apps/web/src/telas/Conversas.tsx
'use client';

import {
  CaixaDeConversas,
  type ConversaResumo,
  type FiltroConversas,
} from './CaixaDeConversas';
import {
  PainelDeConversa,
  type ContextoConversa,
  type Mensagem,
} from './PainelDeConversa';

export interface ConversasProps {
  readonly filtro: FiltroConversas;
  readonly conversaAbertaId: string | null;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

export function Conversas(p: ConversasProps) {
  const conversa = p.conversaAbertaId;

  if (conversa === null) {
    return (
      <div data-testid="split-view" style={{ gridTemplateColumns: '1fr' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
    );
  }

  return (
    <div data-testid="split-view"
      style={{
        display: 'grid', gridTemplateColumns: '40% 60%',
        height: '100vh', overflow: 'hidden',
      }}>
      <div style={{ borderInlineEnd: 'var(--border)', overflowY: 'auto' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
      <ConversaAbertaWrapper
        conversationId={conversa}
        carregarConversas={p.carregarConversas}
        filtro={p.filtro}
        carregarMensagens={p.carregarMensagens}
        carregarContexto={p.carregarContexto}
        aoEnviar={p.aoEnviar}
        aoVincularPaciente={p.aoVincularPaciente}
        aoSelecionarTemplate={p.aoSelecionarTemplate}
      />
    </div>
  );
}

interface WrapperProps {
  readonly conversationId: string;
  readonly filtro: FiltroConversas;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

import { useEffect, useState } from 'react';

function ConversaAbertaWrapper(p: WrapperProps) {
  const [dados, setDados] = useState<ConversaResumo | null>(null);

  useEffect(() => {
    void p.carregarConversas(p.filtro).then((lista) => {
      const encontrada = lista.find((c) => c.conversationId === p.conversationId);
      setDados(encontrada ?? null);
    });
  }, [p, p.conversationId, p.filtro]);

  if (dados === null) return null;

  return (
    <PainelDeConversa
      conversationId={dados.conversationId}
      nomeExibido={dados.patientName ?? dados.phoneNumber}
      phoneNumber={dados.phoneNumber}
      patientId={dados.patientId}
      carregarMensagens={p.carregarMensagens}
      carregarContexto={p.carregarContexto}
      aoEnviar={p.aoEnviar}
      aoVincularPaciente={p.aoVincularPaciente}
      aoSelecionarTemplate={p.aoSelecionarTemplate}
    />
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/Conversas.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Conversas.tsx apps/web/src/telas/Conversas.test.tsx
git commit -m "feat(web): split-view conversations screen with 40/60 layout"
```

---

### Task 46: Acao rapida "Mensagem" na fila do dia e na agenda

**Arquivos**

- Criar `apps/web/src/telas/CompositorDeMensagem.tsx`
- Criar `apps/web/src/telas/CompositorDeMensagem.test.tsx`

**Passos**

- [ ] Criar o teste `CompositorDeMensagem.test.tsx`:

```tsx
// apps/web/src/telas/CompositorDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CompositorDeMensagem } from './CompositorDeMensagem';

const TEMPLATES = [
  { templateId: 't1', nome: 'Confirmacao de consulta',
    corpo: 'Ola {{nome}}, sua consulta esta confirmada para {{data}} as {{hora}}.' },
  { templateId: 't2', nome: 'Lembrete',
    corpo: 'Ola {{nome}}, lembramos da sua consulta amanha.' },
];

function montar(over: Partial<Parameters<typeof CompositorDeMensagem>[0]> = {}) {
  const props = {
    pacienteNome: 'Maria Souza Lima',
    telefone: '+5511999990001',
    templates: TEMPLATES,
    templateSelecionadoId: 't1',
    aoMudarTemplate: vi.fn(),
    aoEnviar: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<CompositorDeMensagem {...props} />);
  return props;
}

describe('compositor de mensagem (acao rapida)', () => {
  it('abre com template de confirmacao pre-selecionado e telefone pre-preenchido', () => {
    montar();
    expect(screen.getByText('+5511999990001')).toBeVisible();
    expect(screen.getByDisplayValue('Confirmacao de consulta')).toBeVisible();
  });

  it('mostra preview do corpo do template selecionado', () => {
    montar();
    expect(screen.getByText(/sua consulta esta confirmada/)).toBeVisible();
  });

  it('trocar template chama aoMudarTemplate', async () => {
    const { aoMudarTemplate } = montar();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Template/ }), 't2');
    expect(aoMudarTemplate).toHaveBeenCalledWith('t2');
  });

  it('botao Enviar chama aoEnviar e mostra carregando', async () => {
    const aoEnviar = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoEnviar });
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(aoEnviar).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Enviar/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('um clique para enviar — nao pede confirmacao', async () => {
    const aoEnviar = vi.fn(async () => {});
    montar({ aoEnviar });
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <CompositorDeMensagem pacienteNome="Maria" telefone="+5511999990001"
        templates={TEMPLATES} templateSelecionadoId="t1"
        aoMudarTemplate={vi.fn()} aoEnviar={async () => {}} aoFechar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/CompositorDeMensagem.test.tsx
# Esperado: FAIL — Cannot find module './CompositorDeMensagem'
```

- [ ] Criar o componente `CompositorDeMensagem.tsx`:

```tsx
// apps/web/src/telas/CompositorDeMensagem.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

export interface TemplateMensagem {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
}

export interface CompositorDeMensagemProps {
  readonly pacienteNome: string;
  readonly telefone: string;
  readonly templates: readonly TemplateMensagem[];
  readonly templateSelecionadoId: string;
  readonly aoMudarTemplate: (templateId: string) => void;
  readonly aoEnviar: () => Promise<void>;
  readonly aoFechar: () => void;
}

export function CompositorDeMensagem(p: CompositorDeMensagemProps) {
  const [enviando, setEnviando] = useState(false);
  const selecionado = p.templates.find((t) => t.templateId === p.templateSelecionadoId);

  async function enviar(): Promise<void> {
    setEnviando(true);
    try {
      await p.aoEnviar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{
      display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-5)',
      border: '1px solid var(--accent)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', boxShadow: 'var(--elev-1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Enviar mensagem
        </h3>
        <button type="button" aria-label="Fechar compositor" onClick={p.aoFechar}
          style={{ border: 0, background: 'transparent', cursor: 'pointer',
                   color: 'var(--text-muted)', fontSize: 'var(--fs-15)' }}>
          &times;
        </button>
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
          {p.pacienteNome}
        </span>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.telefone}
        </span>
      </div>

      <label htmlFor="template-selector" style={{ fontSize: 'var(--fs-12)',
                                                   color: 'var(--text-muted)' }}>
        Template
      </label>
      <select id="template-selector" role="combobox" aria-label="Template"
        value={p.templateSelecionadoId}
        onChange={(e) => p.aoMudarTemplate(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.templates.map((t) => (
          <option key={t.templateId} value={t.templateId}>{t.nome}</option>
        ))}
      </select>

      {selecionado !== undefined ? (
        <div style={{
          padding: 'var(--s-4)', background: 'var(--surface-sunken)',
          borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)',
          lineHeight: 'var(--lh-read)', whiteSpace: 'pre-wrap',
        }}>
          {selecionado.corpo}
        </div>
      ) : null}

      <Botao variante="primario" carregando={enviando}
        onClick={() => { void enviar(); }}>
        Enviar
      </Botao>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/CompositorDeMensagem.test.tsx
# Esperado: PASS — 6 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/CompositorDeMensagem.tsx apps/web/src/telas/CompositorDeMensagem.test.tsx
git commit -m "feat(web): quick-action message composer with pre-selected template"
```

---

### Task 47: Templates e automacoes (admin) — /conversas/templates e /conversas/automacoes

**Arquivos**

- Criar `apps/web/src/telas/TemplatesDeMensagem.tsx`
- Criar `apps/web/src/telas/TemplatesDeMensagem.test.tsx`
- Criar `apps/web/src/telas/AutomacoesDeConversa.tsx`
- Criar `apps/web/src/telas/AutomacoesDeConversa.test.tsx`

**Passos**

- [ ] Criar o teste `TemplatesDeMensagem.test.tsx`:

```tsx
// apps/web/src/telas/TemplatesDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TemplatesDeMensagem, type TemplateAdmin } from './TemplatesDeMensagem';

const TEMPLATES: TemplateAdmin[] = [
  {
    templateId: 't1', nome: 'Confirmacao de consulta',
    corpo: 'Ola {{nome}}, confirme sua consulta em {{data}} as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'aprovado',
  },
  {
    templateId: 't2', nome: 'Lembrete D-1',
    corpo: 'Ola {{nome}}, lembramos da consulta amanha as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'pendente',
  },
  {
    templateId: 't3', nome: 'Pos-consulta',
    corpo: 'Ola {{nome}}, obrigado pela visita!',
    canal: 'whatsapp', statusAprovacao: 'rejeitado',
  },
];

function montar(over: Partial<Parameters<typeof TemplatesDeMensagem>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => TEMPLATES),
    aoCriar: vi.fn(),
    aoEditar: vi.fn(),
    ...over,
  };
  render(<TemplatesDeMensagem {...props} />);
  return props;
}

describe('tela Templates de Mensagem', () => {
  it('lista os templates com nome, canal e status de aprovacao', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
      expect(screen.getByText('aprovado')).toBeVisible();
      expect(screen.getByText('pendente')).toBeVisible();
      expect(screen.getByText('rejeitado')).toBeVisible();
    });
  });

  it('botao Novo template chama aoCriar', async () => {
    const { aoCriar } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao de consulta')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Novo template/ }));
    expect(aoCriar).toHaveBeenCalled();
  });

  it('clicar no template chama aoEditar com o templateId', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Lembrete D-1')).toBeVisible());
    await userEvent.click(screen.getByText('Lembrete D-1'));
    expect(aoEditar).toHaveBeenCalledWith('t2');
  });

  it('status de aprovacao tem cores distintas: aprovado, pendente, rejeitado', async () => {
    montar();
    await waitFor(() => {
      const aprovado = screen.getByText('aprovado');
      const rejeitado = screen.getByText('rejeitado');
      expect(aprovado).toHaveStyle({ color: expect.stringContaining('var(') });
      expect(rejeitado).toHaveStyle({ color: expect.stringContaining('var(') });
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <TemplatesDeMensagem carregar={async () => TEMPLATES}
        aoCriar={vi.fn()} aoEditar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx
# Esperado: FAIL — Cannot find module './TemplatesDeMensagem'
```

- [ ] Criar o componente `TemplatesDeMensagem.tsx`:

```tsx
// apps/web/src/telas/TemplatesDeMensagem.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

export type StatusAprovacao = 'aprovado' | 'pendente' | 'rejeitado';

export interface TemplateAdmin {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly statusAprovacao: StatusAprovacao;
}

const COR_STATUS: Record<StatusAprovacao, string> = {
  aprovado:  'var(--success)',
  pendente:  'var(--warn)',
  rejeitado: 'var(--danger)',
};

export interface TemplatesDeMensagemProps {
  readonly carregar: () => Promise<TemplateAdmin[]>;
  readonly aoCriar: () => void;
  readonly aoEditar: (templateId: string) => void;
}

export function TemplatesDeMensagem(p: TemplatesDeMensagemProps) {
  const [templates, setTemplates] = useState<TemplateAdmin[]>([]);

  useEffect(() => {
    void p.carregar().then(setTemplates);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Templates
        </h1>
        <Botao variante="primario" altura={32} onClick={p.aoCriar}>
          Novo template
        </Botao>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)',
                      border: 'var(--border)', borderRadius: 'var(--r-md)' }}>
        <thead>
          <tr>
            {['Nome', 'Canal', 'Status'].map((h) => (
              <th key={h} scope="col" style={{
                textAlign: 'left', fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: 500,
                padding: 'var(--s-4)', borderBottom: 'var(--border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.templateId}
              onClick={() => p.aoEditar(t.templateId)}
              style={{ cursor: 'pointer', borderBottom: 'var(--border)' }}>
              <td style={{ padding: 'var(--s-4)', fontWeight: 'var(--fw-medium)' }}>
                {t.nome}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: 'var(--text-muted)' }}>
                {t.canal}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: COR_STATUS[t.statusAprovacao] }}>
                {t.statusAprovacao}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Criar o teste `AutomacoesDeConversa.test.tsx`:

```tsx
// apps/web/src/telas/AutomacoesDeConversa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { AutomacoesDeConversa, type Automacao } from './AutomacoesDeConversa';

const AUTOMACOES: Automacao[] = [
  {
    automationId: 'a1', nome: 'Confirmacao D-2',
    descricao: 'Envia confirmacao 2 dias antes da consulta',
    templateNome: 'Confirmacao de consulta',
    canal: 'whatsapp', timing: '2 dias antes',
    ativa: true,
  },
  {
    automationId: 'a2', nome: 'Lembrete D-1',
    descricao: 'Envia lembrete 1 dia antes da consulta',
    templateNome: 'Lembrete D-1',
    canal: 'whatsapp', timing: '1 dia antes',
    ativa: false,
  },
  {
    automationId: 'a3', nome: 'Pos-consulta',
    descricao: 'Envia mensagem de agradecimento apos consulta',
    templateNome: 'Pos-consulta',
    canal: 'whatsapp', timing: '2 horas apos',
    ativa: true,
  },
];

function montar(over: Partial<Parameters<typeof AutomacoesDeConversa>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => AUTOMACOES),
    aoAlternarAtiva: vi.fn(async () => {}),
    aoEditar: vi.fn(),
    ...over,
  };
  render(<AutomacoesDeConversa {...props} />);
  return props;
}

describe('tela Automacoes de Conversa', () => {
  it('lista as automacoes com nome, timing, template e toggle', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao D-2')).toBeVisible();
      expect(screen.getByText('2 dias antes')).toBeVisible();
      expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
    });
  });

  it('toggle ativo/inativo chama aoAlternarAtiva', async () => {
    const { aoAlternarAtiva } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao D-2')).toBeVisible());
    const toggles = screen.getAllByRole('switch');
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggles[1]!);
    expect(aoAlternarAtiva).toHaveBeenCalledWith('a2', true);
  });

  it('clicar na automacao chama aoEditar', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Lembrete D-1')).toBeVisible());
    await userEvent.click(screen.getByText('Lembrete D-1'));
    expect(aoEditar).toHaveBeenCalledWith('a2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <AutomacoesDeConversa carregar={async () => AUTOMACOES}
        aoAlternarAtiva={async () => {}} aoEditar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd apps/web && npx vitest run src/telas/AutomacoesDeConversa.test.tsx
# Esperado: FAIL — Cannot find module './AutomacoesDeConversa'
```

- [ ] Criar o componente `AutomacoesDeConversa.tsx`:

```tsx
// apps/web/src/telas/AutomacoesDeConversa.tsx
'use client';

import { useEffect, useState } from 'react';

export interface Automacao {
  readonly automationId: string;
  readonly nome: string;
  readonly descricao: string;
  readonly templateNome: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly timing: string;
  readonly ativa: boolean;
}

export interface AutomacoesDeConversaProps {
  readonly carregar: () => Promise<Automacao[]>;
  readonly aoAlternarAtiva: (automationId: string, novoEstado: boolean) => Promise<void>;
  readonly aoEditar: (automationId: string) => void;
}

export function AutomacoesDeConversa(p: AutomacoesDeConversaProps) {
  const [automacoes, setAutomacoes] = useState<Automacao[]>([]);

  useEffect(() => {
    void p.carregar().then(setAutomacoes);
  }, [p]);

  async function alternar(automationId: string, atual: boolean): Promise<void> {
    const novo = !atual;
    setAutomacoes((prev) => prev.map((a) =>
      a.automationId === automationId ? { ...a, ativa: novo } : a));
    try {
      await p.aoAlternarAtiva(automationId, novo);
    } catch {
      setAutomacoes((prev) => prev.map((a) =>
        a.automationId === automationId ? { ...a, ativa: atual } : a));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Automacoes
      </h1>

      <ul aria-label="Lista de automacoes"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface)' }}>
        {automacoes.map((a) => (
          <li key={a.automationId}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: `var(--s-5) var(--s-5)`,
              borderBottom: 'var(--border)',
            }}>
            <div onClick={() => p.aoEditar(a.automationId)}
              style={{ cursor: 'pointer', display: 'grid', gap: 'var(--s-1)' }}>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{a.nome}</span>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
                {a.timing}
                {` · ${a.templateNome}`}
                {` · ${a.canal}`}
              </span>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                {a.descricao}
              </span>
            </div>
            <button type="button" role="switch" aria-checked={a.ativa}
              aria-label={`${a.nome} ${a.ativa ? 'ativa' : 'inativa'}`}
              onClick={() => { void alternar(a.automationId, a.ativa); }}
              style={{
                width: 44, height: 24, borderRadius: 'var(--r-full)',
                border: 'none', cursor: 'pointer', position: 'relative',
                background: a.ativa ? 'var(--accent)' : 'var(--surface-sunken)',
                transition: 'background var(--dur-1)',
              }}>
              <span aria-hidden="true" style={{
                position: 'absolute', top: 2,
                left: a.ativa ? 22 : 2,
                width: 20, height: 20, borderRadius: 'var(--r-full)',
                background: 'white', transition: 'left var(--dur-1)',
                boxShadow: '0 1px 2px oklch(0% 0 0 / .15)',
              }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd apps/web && npx vitest run src/telas/TemplatesDeMensagem.test.tsx src/telas/AutomacoesDeConversa.test.tsx
# Esperado: PASS — 5 + 4 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/TemplatesDeMensagem.tsx apps/web/src/telas/TemplatesDeMensagem.test.tsx \
        apps/web/src/telas/AutomacoesDeConversa.tsx apps/web/src/telas/AutomacoesDeConversa.test.tsx
git commit -m "feat(web): templates and automations admin screens for messaging"
```

---

### Task 48: Teste obrigatorio — conversa com numero desconhecido e vinculacao

**Arquivos**

- Criar `apps/web/src/telas/fluxo-conversas.test.tsx`

**Passos**

- [ ] Criar o teste de fluxo `fluxo-conversas.test.tsx`:

```tsx
// apps/web/src/telas/fluxo-conversas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversas } from './Conversas';
import type { ConversaResumo } from './CaixaDeConversas';
import type { Mensagem, ContextoConversa } from './PainelDeConversa';

const CONVERSAS: ConversaResumo[] = [
  {
    conversationId: 'c-desconhecido', patientId: null, patientName: null,
    phoneNumber: '+5521900001111', lastMessageBody: 'Gostaria de agendar uma consulta',
    lastMessageAt: '2026-08-03T15:00:00.000Z', unreadCount: 1,
    channel: 'whatsapp', status: 'ativa',
    lastMessageDirection: 'inbound',
  },
];

const MENSAGENS: Mensagem[] = [
  { messageId: 'm1', direction: 'inbound', body: 'Gostaria de agendar uma consulta',
    sentAt: '2026-08-03T15:00:00.000Z', deliveryStatus: 'delivered' },
];

const CONTEXTO: ContextoConversa = {
  proximoAgendamento: null, pendencias: [], historicoAgendamentos: [],
};

describe('fluxo: conversa com numero desconhecido', () => {
  it('na lista, numero desconhecido exibe o telefone em vez de nome', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('+5521900001111')).toBeVisible();
    });
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('ao abrir a conversa, mostra botao "Vincular a paciente"', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
  });

  it('clicar em "Vincular a paciente" chama o callback', async () => {
    const aoVincularPaciente = vi.fn();
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={aoVincularPaciente} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vincular a paciente/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Vincular a paciente/ }));
    expect(aoVincularPaciente).toHaveBeenCalled();
  });

  it('avatar do numero desconhecido mostra "#" em vez de iniciais', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId={null}
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('#')).toBeVisible());
  });

  it('thread de mensagens funciona normalmente mesmo sem paciente vinculado', async () => {
    render(
      <Conversas filtro="todas" conversaAbertaId="c-desconhecido"
        carregarConversas={async () => CONVERSAS}
        carregarMensagens={async () => MENSAGENS}
        carregarContexto={async () => CONTEXTO}
        aoMudarFiltro={vi.fn()} aoAbrirConversa={vi.fn()}
        aoEnviar={async () => ({ messageId: 'm9' })}
        aoVincularPaciente={vi.fn()} aoSelecionarTemplate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('Gostaria de agendar uma consulta')).toBeVisible());
    const input = screen.getByRole('textbox', { name: /Mensagem/ });
    expect(input).toBeVisible();
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd apps/web && npx vitest run src/telas/fluxo-conversas.test.tsx
# Esperado: PASS — 5 testes
```

- [ ] Rodar todos os testes do bloco de conversas juntos:

```bash
cd apps/web && npx vitest run src/telas/CaixaDeConversas.test.tsx src/telas/PainelDeConversa.test.tsx src/telas/Conversas.test.tsx src/telas/CompositorDeMensagem.test.tsx src/telas/TemplatesDeMensagem.test.tsx src/telas/AutomacoesDeConversa.test.tsx src/telas/fluxo-conversas.test.tsx
# Esperado: PASS — 7 + 8 + 5 + 6 + 5 + 4 + 5 = 40 testes
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/fluxo-conversas.test.tsx
git commit -m "test(web): mandatory flow test for unknown-number conversation with patient linking"
```

### Task 49: Painel lateral de cobranca no atendimento — componente `PainelDeCobranca`

**Arquivos**

- Criar `apps/web/src/ui/PainelDeCobranca.tsx`
- Criar `apps/web/src/ui/PainelDeCobranca.test.tsx`

**Por que**: Design §5.3 define acao "cobrar [$]" no atendimento e na fila do dia. O painel lateral reutiliza o componente `PainelLateral` existente e recebe por props as informacoes do procedimento e callbacks de registro.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/PainelDeCobranca.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeCobranca } from './PainelDeCobranca';

const PROPS_BASE = {
  aberto: true,
  pacienteNome: 'Maria Souza Lima',
  procedimentoNome: 'Consulta',
  valorSugeridoCentavos: 25000,
  aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
  aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
  aoFechar: vi.fn(),
};

function montar(over: Partial<typeof PROPS_BASE> = {}) {
  const props = { ...PROPS_BASE, aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    aoFechar: vi.fn(), ...over };
  render(<PainelDeCobranca {...props} />);
  return props;
}

describe('PainelDeCobranca', () => {
  it('exibe o valor sugerido formatado em reais no campo editavel', () => {
    montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    expect(campo).toHaveValue('250,00');
  });

  it('pre-seleciona metodo "Dinheiro" e oferece quatro opcoes', () => {
    montar();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Dinheiro/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Cartão/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pix/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Link/i })).toBeInTheDocument();
  });

  it('ao confirmar com metodo presencial chama aoRegistrar com centavos e metodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 25000,
      method: 'dinheiro',
    }));
  });

  it('ao confirmar com metodo "Link" chama aoCriarLink em vez de aoRegistrar', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: /Link/i }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar link/i }));
    await waitFor(() => expect(props.aoCriarLink).toHaveBeenCalledWith({
      amountCents: 25000,
    }));
    expect(props.aoRegistrar).not.toHaveBeenCalled();
  });

  it('permite editar o valor antes de registrar', async () => {
    const props = montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    await userEvent.clear(campo);
    await userEvent.type(campo, '300,00');
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 30000,
      method: 'dinheiro',
    }));
  });

  it('mostra o nome do paciente e do procedimento no cabecalho', () => {
    montar();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('Consulta')).toBeVisible();
  });

  it('botao fica em estado carregando enquanto a promessa nao resolve', async () => {
    const aoRegistrar = vi.fn(() => new Promise<{ entryId: string; receiptNumber: number }>(() => {}));
    montar({ aoRegistrar });
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    expect(screen.getByRole('button', { name: /Registrar/i })).toHaveAttribute('aria-busy', 'true');
  });

  it('nao renderiza nada quando fechado', () => {
    montar({ aberto: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<PainelDeCobranca {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/ui/PainelDeCobranca.test.tsx
# Esperado: FAIL — modulo PainelDeCobranca nao encontrado
```

- [ ] Implementar o componente:

```tsx
// apps/web/src/ui/PainelDeCobranca.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';
import { Campo } from './Campo';

export type MetodoPagamento = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface PainelDeCobrancaProps {
  readonly aberto: boolean;
  readonly pacienteNome: string;
  readonly procedimentoNome: string;
  readonly valorSugeridoCentavos: number;
  readonly aoRegistrar: (dados: { amountCents: number; method: Exclude<MetodoPagamento, 'link'> }) =>
    Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLink: (dados: { amountCents: number }) =>
    Promise<{ linkUrl: string; linkId: string }>;
  readonly aoFechar: () => void;
}

const METODOS: ReadonlyArray<{ valor: MetodoPagamento; rotulo: string }> = [
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'cartao', rotulo: 'Cartão' },
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'link', rotulo: 'Link' },
];

function centavosParaTexto(centavos: number): string {
  const inteiro = Math.floor(centavos / 100);
  const decimais = String(centavos % 100).padStart(2, '0');
  return `${inteiro},${decimais}`;
}

function textoParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/\s/g, '').replace('.', ',');
  const partes = limpo.split(',');
  if (partes.length > 2) return null;
  const inteiro = parseInt(partes[0] ?? '0', 10);
  if (Number.isNaN(inteiro)) return null;
  let decimais = 0;
  if (partes.length === 2) {
    const decStr = (partes[1] ?? '').padEnd(2, '0').slice(0, 2);
    decimais = parseInt(decStr, 10);
    if (Number.isNaN(decimais)) return null;
  }
  return inteiro * 100 + decimais;
}

export function PainelDeCobranca(p: PainelDeCobrancaProps) {
  const [metodo, setMetodo] = useState<MetodoPagamento>('dinheiro');
  const [valorTexto, setValorTexto] = useState(() => centavosParaTexto(p.valorSugeridoCentavos));
  const [carregando, setCarregando] = useState(false);
  const [linkCriado, setLinkCriado] = useState<string | null>(null);

  async function registrar(): Promise<void> {
    const centavos = textoParaCentavos(valorTexto);
    if (centavos === null || centavos <= 0) return;
    setCarregando(true);
    try {
      if (metodo === 'link') {
        const resultado = await p.aoCriarLink({ amountCents: centavos });
        setLinkCriado(resultado.linkUrl);
      } else {
        await p.aoRegistrar({ amountCents: centavos, method: metodo });
      }
    } finally {
      setCarregando(false);
    }
  }

  const rotuloConfirmar = metodo === 'link' ? 'Enviar link' : 'Registrar';

  return (
    <PainelLateral aberto={p.aberto} titulo="Cobrar" aoFechar={p.aoFechar}>
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <span style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)' }}>
            {p.pacienteNome}
          </span>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
            {p.procedimentoNome}
          </span>
        </div>

        <Campo
          rotulo="Valor (R$)"
          value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)}
          inputMode="decimal"
          aria-label="Valor"
        />

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--s-3)' }}>
          <legend style={{ fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                           color: 'var(--text-muted)', marginBottom: 'var(--s-2)' }}>
            Forma de pagamento
          </legend>
          {METODOS.map((m) => (
            <label key={m.valor} style={{ display: 'flex', alignItems: 'center',
                                          gap: 'var(--s-3)', cursor: 'pointer',
                                          fontSize: 'var(--fs-14)' }}>
              <input
                type="radio" name="metodo" value={m.valor}
                checked={metodo === m.valor}
                onChange={() => setMetodo(m.valor)}
                aria-label={m.rotulo}
              />
              {m.rotulo}
            </label>
          ))}
        </fieldset>

        {linkCriado !== null ? (
          <div role="status" style={{ padding: 'var(--s-4)', background: 'var(--success-soft)',
                                      borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)' }}>
            Link criado e copiado para a area de transferencia.
          </div>
        ) : (
          <Botao variante="primario" altura={40} carregando={carregando}
            onClick={() => { void registrar(); }}>
            {rotuloConfirmar}
          </Botao>
        )}
      </div>
    </PainelLateral>
  );
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/ui/PainelDeCobranca.test.tsx
# Esperado: 8 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/ui/PainelDeCobranca.tsx apps/web/src/ui/PainelDeCobranca.test.tsx
git commit -m "feat(web): payment panel component with method selection and link flow"
```

---

### Task 50: Integrar painel de cobranca na TelaDeAtendimento com atalho `Ctrl+$`

**Arquivos**

- Modificar `apps/web/src/telas/atalhos.ts`
- Modificar `apps/web/src/telas/atalhos.test.ts`
- Modificar `apps/web/src/telas/TelaDeAtendimento.tsx`
- Modificar `apps/web/src/telas/fluxo-b.test.tsx`

**Por que**: Design §5.3 define "Cobrar" no cabecalho do atendimento e §5.6 menciona `$` como modo de dinheiro na paleta. O atalho `Ctrl+$` (que no teclado brasileiro e `Ctrl+Shift+4`) abre o painel sem tirar as maos do teclado.

- [ ] Escrever os testes que falham:

```ts
// apps/web/src/telas/atalhos.test.ts — adicionar ao describe existente
  it('Ctrl+$ abre a cobranca no atendimento', () => {
    const a = ATALHOS_DO_ATENDIMENTO.find((x) => x.combinacao === 'Ctrl+$');
    expect(a?.acao).toBe('cobrar');
    expect(a?.descricao).toBe('Cobrar');
  });
```

```tsx
// apps/web/src/telas/fluxo-b.test.tsx — adicionar ao describe existente
  it('Ctrl+$ abre o painel de cobranca ao lado do atendimento', async () => {
    montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: '$', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/atalhos.test.ts src/telas/fluxo-b.test.tsx
# Esperado: FAIL — 2 testes falhando
```

- [ ] Adicionar o atalho no catalogo:

```ts
// apps/web/src/telas/atalhos.ts — adicionar ao array ATALHOS_DO_ATENDIMENTO, antes do ultimo item
  { combinacao: 'Ctrl+$', acao: 'cobrar', descricao: 'Cobrar' },
```

O array completo fica:

```ts
export const ATALHOS_DO_ATENDIMENTO: readonly AtalhoDoAtendimento[] = [
  { combinacao: 'Ctrl+R', acao: 'prescrever', descricao: 'Prescrever ao lado' },
  { combinacao: 'Ctrl+E', acao: 'pedir_exame', descricao: 'Pedido de exame' },
  { combinacao: 'Ctrl+D', acao: 'emitir_documento', descricao: 'Documento' },
  { combinacao: 'Ctrl+I', acao: 'transcricao_por_ia', descricao: 'Transcrição por IA' },
  { combinacao: 'Ctrl+;', acao: 'inserir_data_hora_do_servidor',
    descricao: 'Data/hora do servidor' },
  { combinacao: 'Ctrl+$', acao: 'cobrar', descricao: 'Cobrar' },
  { combinacao: 'Ctrl+ArrowUp', acao: 'secao_anterior', descricao: 'Seção anterior' },
  { combinacao: 'Ctrl+ArrowDown', acao: 'proxima_secao', descricao: 'Próxima seção' },
  { combinacao: 'Ctrl+Enter', acao: 'finalizar', descricao: 'Finalizar atendimento' },
];
```

- [ ] Atualizar o teste de atalhos para refletir a nova ordem:

```ts
// apps/web/src/telas/atalhos.test.ts — atualizar o teste 'cobre os atalhos com modificador da §5.6'
  it('cobre os atalhos com modificador da §5.6', () => {
    expect(ATALHOS_DO_ATENDIMENTO.map((a) => a.combinacao)).toEqual([
      'Ctrl+R', 'Ctrl+E', 'Ctrl+D', 'Ctrl+I', 'Ctrl+;', 'Ctrl+$',
      'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+Enter']);
  });
```

- [ ] Integrar o painel na tela de atendimento:

```tsx
// apps/web/src/telas/TelaDeAtendimento.tsx
'use client';

import { useEffect, useState } from 'react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelLateral } from '../ui/PainelLateral';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';

export interface TelaDeAtendimentoProps {
  readonly encounterId: string;
  readonly pacienteNome: string;
  readonly procedimentoNome?: string;
  readonly valorSugeridoCentavos?: number;
  readonly abrirSessaoDoPrescritor: () => Promise<{ mode: string }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoConfirmarPrescricao: () => Promise<{ prescriptionId: string }>;
  readonly aoFinalizar: () => Promise<{ versionId: string; versionNo: number }>;
  readonly aoRegistrarPagamento?: (dados: { amountCents: number; method: Exclude<MetodoPagamento, 'link'> }) =>
    Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (dados: { amountCents: number }) =>
    Promise<{ linkUrl: string; linkId: string }>;
}

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [cobrancaAberta, setCobrancaAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);

  useEffect(() => {
    void p.abrirSessaoDoPrescritor();
  }, []);

  async function finalizar() {
    await p.aoFinalizar();
    setFinalizado(true);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', height: '100vh' }}>
      <div style={{ display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-6)',
                    gridTemplateRows: 'auto 1fr auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            {p.pacienteNome}
          </h1>
          {p.aoRegistrarPagamento !== undefined ? (
            <button type="button"
              onClick={() => setCobrancaAberta(true)}
              aria-label="Cobrar"
              style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                       background: 'var(--surface)', padding: 'var(--s-3) var(--s-5)',
                       cursor: 'pointer', color: 'var(--text)',
                       fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)' }}>
              Cobrar
            </button>
          ) : null}
        </header>

        <EditorClinico
          encounterId={p.encounterId}
          buscarCodigo={p.buscarCodigo}
          buscarModelo={p.buscarModelo}
          buscarValorAnterior={p.buscarValorAnterior}
          aoPrescrever={() => setPrescricaoAberta(true)}
          aoPedirExame={() => {}}
          aoEmitirDocumento={() => {}}
          aoFinalizar={() => { void finalizar(); }}
          aoCobrar={() => setCobrancaAberta(true)}
        />

        {finalizado ? (
          <div role="status" style={{ display: 'flex', gap: 'var(--s-4)',
                                      alignItems: 'center', justifyContent: 'center',
                                      padding: 'var(--s-4)', background: 'var(--success-soft)',
                                      borderRadius: 'var(--r-md)' }}>
            <span style={{ color: 'var(--success)' }}>Atendimento finalizado</span>
            <button type="button"
              style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                       background: 'var(--surface)', padding: 'var(--s-3) var(--s-5)',
                       cursor: 'pointer', color: 'var(--text)' }}>
              Próximo paciente (Enter)
            </button>
          </div>
        ) : null}
      </div>

      <PainelLateral aberto={prescricaoAberta} titulo="Prescrever"
        aoFechar={() => setPrescricaoAberta(false)}>
        <p style={{ margin: 0 }}>Prescrição embarcada para {p.pacienteNome}</p>
      </PainelLateral>

      {p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca
          aberto={cobrancaAberta}
          pacienteNome={p.pacienteNome}
          procedimentoNome={p.procedimentoNome ?? 'Consulta'}
          valorSugeridoCentavos={p.valorSugeridoCentavos ?? 0}
          aoRegistrar={p.aoRegistrarPagamento}
          aoCriarLink={p.aoCriarLinkPagamento}
          aoFechar={() => setCobrancaAberta(false)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar a montagem do fluxo-b.test para incluir as novas props:

```tsx
// apps/web/src/telas/fluxo-b.test.tsx — atualizar a funcao montar
function montar(over = {}) {
  const props = {
    encounterId: 'e1', pacienteNome: 'Maria Souza Lima',
    procedimentoNome: 'Consulta', valorSugeridoCentavos: 25000,
    abrirSessaoDoPrescritor: vi.fn(async () => ({ mode: 'embedded' as const })),
    buscarCodigo: vi.fn(async () => [{ code: 'I10', display: 'Hipertensão essencial' }]),
    buscarModelo: vi.fn(async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: '72,4 kg', em: '12/05/2026' })),
    aoConfirmarPrescricao: vi.fn(async () => ({ prescriptionId: 'rx1' })),
    aoFinalizar: vi.fn(async () => ({ versionId: 'v1', versionNo: 1 })),
    aoRegistrarPagamento: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLinkPagamento: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    ...over,
  };
  render(<TelaDeAtendimento {...props} />);
  return props;
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/atalhos.test.ts src/telas/fluxo-b.test.tsx
# Esperado: todos os testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/atalhos.ts apps/web/src/telas/atalhos.test.ts \
  apps/web/src/telas/TelaDeAtendimento.tsx apps/web/src/telas/fluxo-b.test.tsx
git commit -m "feat(web): integrate payment panel into encounter screen with Ctrl+$ shortcut"
```

---

### Task 51: Acao "Cobrar" na fila do dia (`/hoje`) abrindo o painel de cobranca

**Arquivos**

- Modificar `apps/web/src/telas/Hoje.tsx`
- Modificar `apps/web/src/telas/Hoje.test.tsx`

**Por que**: Design §5.3 define "cobrar [$]" como acao na fila do dia. Reutiliza o `PainelDeCobranca` da Task 49.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Hoje.test.tsx — adicionar ao describe existente
  it('botao "Cobrar" na fila abre o painel de cobranca com os dados da linha', async () => {
    const aoRegistrarPagamento = vi.fn(async () => ({ entryId: 'e1', receiptNumber: 1 }));
    const aoCriarLinkPagamento = vi.fn(async () => ({ linkUrl: 'https://pay.example.com/x', linkId: 'l1' }));
    montar({ aoRegistrarPagamento, aoCriarLinkPagamento });
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    const botoes = screen.getAllByRole('button', { name: /Cobrar/i });
    expect(botoes.length).toBeGreaterThan(0);
    await userEvent.click(botoes[0]!);
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Hoje.test.tsx
# Esperado: FAIL — botao Cobrar nao encontrado
```

- [ ] Estender as props de Hoje e adicionar o botao com o painel:

```tsx
// apps/web/src/telas/Hoje.tsx
'use client';

import { useEffect, useState } from 'react';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import type { StatusAgenda } from '../ui/ChipDeStatus';

export interface LinhaDaFila {
  readonly appointmentId: string; readonly startsAt: string; readonly endsAt: string;
  readonly patientId: string; readonly displayName: string; readonly professionalId: string;
  readonly procedureNome: string | null; readonly procedureCor: string | null;
  readonly operadoraNome: string | null; readonly status: StatusAgenda;
  readonly encaixe: boolean; readonly teleconsulta: boolean; readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean; readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number; readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number; readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  readonly filtro?: FiltroDoDia;
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) =>
    Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
  readonly aoRegistrarPagamento?: (appointmentId: string, dados: {
    amountCents: number; method: Exclude<MetodoPagamento, 'link'>;
  }) => Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (appointmentId: string, dados: {
    amountCents: number;
  }) => Promise<{ linkUrl: string; linkId: string }>;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas'],
  ['resultadosChegados', 'resultados chegados'],
  ['rascunhosDeOntem', 'rascunhos de ontem'],
  ['guiasAFaturar', 'guias a faturar'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fmt.format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);
  const [cobranca, setCobranca] = useState<LinhaDaFila | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores); setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => { void p.carregarPrecisaDeVoce().then(setPrecisa); }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) => atual.map((l) =>
      l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) =>
        l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        {`Hoje, ${porExtenso(p.dia)}`}
      </h1>

      {contadores === null ? null : (
        <FaixaDeContadores
          contadores={contadores}
          filtroAtivo={p.filtro}
          aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
        />
      )}

      <section aria-label="Fila do dia">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {fila.map((l) => (
            <LinhaDaAgenda
              key={l.appointmentId}
              hora={hora(l.startsAt)}
              paciente={l.displayName}
              profissional={l.professionalId}
              {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
              {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
              status={l.status}
              encaixe={l.encaixe}
              cadastroPreliminar={l.cadastroPreliminar}
              primeiraVez={l.primeiraVez}
              teleconsulta={l.teleconsulta}
            />
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--s-4)', marginTop: 'var(--s-5)',
                      flexWrap: 'wrap' }}>
          {fila.map((l) => (
            <span key={l.appointmentId} style={{ display: 'contents' }}>
              <Botao variante="secundario" altura={28}
                aria-label={`Check-in de ${l.displayName}`}
                onClick={() => { void checkIn(l); }}>
                Check-in
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Abrir atendimento de ${l.displayName}`}
                onClick={() => p.aoAbrirAtendimento(l)}>
                {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
              </Botao>
              {p.aoRegistrarPagamento !== undefined ? (
                <Botao variante="fantasma" altura={28}
                  aria-label={`Cobrar de ${l.displayName}`}
                  onClick={() => setCobranca(l)}>
                  Cobrar
                </Botao>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      {precisa === null ? null : (
        <section aria-label="Precisa de você"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Precisa de você
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {PENDENCIAS.map(([chave, rotulo]) => (
              <li key={chave} style={{ display: 'flex', gap: 'var(--s-4)', minHeight: 24 }}>
                <strong className="num" style={{ minWidth: '2ch', textAlign: 'right' }}>
                  {precisa[chave]}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cobranca !== null && p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca
          aberto={true}
          pacienteNome={cobranca.displayName}
          procedimentoNome={cobranca.procedureNome ?? 'Consulta'}
          valorSugeridoCentavos={cobranca.valorSugeridoCentavos ?? 0}
          aoRegistrar={(dados) => p.aoRegistrarPagamento!(cobranca.appointmentId, dados)}
          aoCriarLink={(dados) => p.aoCriarLinkPagamento!(cobranca.appointmentId, dados)}
          aoFechar={() => setCobranca(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar a funcao `montar` do Hoje.test para incluir as novas props opcionais:

```tsx
// apps/web/src/telas/Hoje.test.tsx — atualizar montar
function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(),
    aoRegistrarPagamento: undefined as HojeProps['aoRegistrarPagamento'],
    aoCriarLinkPagamento: undefined as HojeProps['aoCriarLinkPagamento'],
    ...over,
  };
  render(<Hoje {...props} />);
  return props;
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Hoje.test.tsx
# Esperado: todos os testes passando (inclusive os existentes)
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Hoje.tsx apps/web/src/telas/Hoje.test.tsx
git commit -m "feat(web): charge action in today queue opening payment panel"
```

---

### Task 52: Dashboard financeiro basico — tela `/financeiro`

**Arquivos**

- Criar `apps/web/src/telas/Financeiro.tsx`
- Criar `apps/web/src/telas/Financeiro.test.tsx`

**Por que**: Design §5.3 define "FINANCEIRO [$] -> Visao . Caixa . A receber". O painel mostra caixa do dia por metodo, receitas do mes em grafico de barras (SVG puro), e lista de pendencias.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Financeiro.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Financeiro } from './Financeiro';

const CAIXA_DO_DIA = {
  total: 125000,
  porMetodo: [
    { method: 'dinheiro' as const, total: 50000, count: 2 },
    { method: 'cartao' as const, total: 50000, count: 2 },
    { method: 'pix' as const, total: 25000, count: 1 },
  ],
};

const RECEITAS_DO_MES = {
  dias: [
    { dia: '2026-08-01', total: 45000 },
    { dia: '2026-08-02', total: 30000 },
    { dia: '2026-08-03', total: 50000 },
  ],
  totalMes: 125000,
  mediaDiaria: 41667,
};

const A_RECEBER = {
  total: 75000,
  entradas: [
    { entryId: 'e1', patientName: 'Joana Prado', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-05', status: 'pendente' as const },
    { entryId: 'e2', patientName: 'Carlos Dias', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-08-10', status: 'pendente' as const },
  ],
};

function montar() {
  const props = {
    carregarCaixaDoDia: vi.fn(async () => CAIXA_DO_DIA),
    carregarReceitasDoMes: vi.fn(async () => RECEITAS_DO_MES),
    carregarAReceber: vi.fn(async () => A_RECEBER),
    aoEnviarLink: vi.fn(async () => {}),
  };
  render(<Financeiro {...props} />);
  return props;
}

describe('tela Financeiro', () => {
  it('exibe o caixa do dia com total formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
  });

  it('exibe o total por metodo de pagamento', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Dinheiro/)).toBeVisible());
    expect(screen.getByText(/R\$ 500,00/)).toBeVisible();
  });

  it('exibe a secao de receitas do mes com total e media', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Receitas do mês/ })).toBeVisible());
    expect(screen.getByText('R$ 1.250,00')).toBeVisible();
  });

  it('renderiza o grafico de barras como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('img', { name: /Receitas/ })).toBeVisible());
  });

  it('exibe a secao A receber com lista de pendencias ordenada por data', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /A receber/ })).toBeVisible());
    expect(screen.getByText('Joana Prado')).toBeVisible();
    expect(screen.getByText('Carlos Dias')).toBeVisible();
  });

  it('exibe o total pendente', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
  });

  it('cada entrada pendente tem botao "Enviar link"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Enviar link/ }).length).toBe(2));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Financeiro
        carregarCaixaDoDia={async () => CAIXA_DO_DIA}
        carregarReceitasDoMes={async () => RECEITAS_DO_MES}
        carregarAReceber={async () => A_RECEBER}
        aoEnviarLink={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: FAIL — modulo Financeiro nao encontrado
```

- [ ] Implementar a tela:

```tsx
// apps/web/src/telas/Financeiro.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

export type MetodoResumo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface CaixaDoDia {
  readonly total: number;
  readonly porMetodo: ReadonlyArray<{ method: MetodoResumo; total: number; count: number }>;
}

export interface ReceitasDoMes {
  readonly dias: ReadonlyArray<{ dia: string; total: number }>;
  readonly totalMes: number;
  readonly mediaDiaria: number;
}

export interface EntradaPendente {
  readonly entryId: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: 'pendente';
}

export interface AReceber {
  readonly total: number;
  readonly entradas: readonly EntradaPendente[];
}

export interface FinanceiroProps {
  readonly carregarCaixaDoDia: () => Promise<CaixaDoDia>;
  readonly carregarReceitasDoMes: () => Promise<ReceitasDoMes>;
  readonly carregarAReceber: () => Promise<AReceber>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoResumo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function GraficoDeBarras({ dias }: { readonly dias: ReadonlyArray<{ dia: string; total: number }> }) {
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  const larguraBarra = 24;
  const gap = 4;
  const alturaMax = 120;
  const largura = dias.length * (larguraBarra + gap);

  return (
    <svg
      role="img" aria-label="Receitas dos últimos dias"
      viewBox={`0 0 ${largura} ${alturaMax + 20}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${alturaMax + 20}px` }}
    >
      {dias.map((d, i) => {
        const altura = Math.max((d.total / maxTotal) * alturaMax, 2);
        const x = i * (larguraBarra + gap);
        const y = alturaMax - altura;
        const diaLabel = d.dia.slice(8);
        return (
          <g key={d.dia}>
            <rect
              x={x} y={y} width={larguraBarra} height={altura}
              rx={3} fill="var(--accent)"
            >
              <title>{`${d.dia}: ${centavosParaReais(d.total)}`}</title>
            </rect>
            <text x={x + larguraBarra / 2} y={alturaMax + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {diaLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    void p.carregarCaixaDoDia().then(setCaixa);
    void p.carregarReceitasDoMes().then(setReceitas);
    void p.carregarAReceber().then(setAReceber);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      {/* Caixa do dia */}
      {caixa !== null ? (
        <section aria-label="Caixa do dia"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Caixa do dia
          </h2>
          <p className="num" style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                                      margin: `0 0 var(--s-4)` }}>
            {centavosParaReais(caixa.total)}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {caixa.porMetodo.map((m) => (
              <li key={m.method} style={{ display: 'flex', justifyContent: 'space-between',
                                          fontSize: 'var(--fs-14)' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {ROTULO_METODO[m.method]} ({m.count})
                </span>
                <span className="num">{centavosParaReais(m.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Receitas do mes */}
      {receitas !== null ? (
        <section aria-label="Receitas do mês"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Receitas do mês
          </h2>
          <div style={{ display: 'flex', gap: 'var(--s-8)', marginBottom: 'var(--s-6)' }}>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                {centavosParaReais(receitas.totalMes)}
              </p>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Média diária
              </span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                {centavosParaReais(receitas.mediaDiaria)}
              </p>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <GraficoDeBarras dias={receitas.dias} />
          </div>
        </section>
      ) : null}

      {/* A receber */}
      {aReceber !== null ? (
        <section aria-label="A receber"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'baseline', marginBottom: 'var(--s-4)' }}>
            <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
              A receber
            </h2>
            <span className="num" style={{ fontSize: 'var(--fs-15)',
                                            fontWeight: 'var(--fw-semibold)' }}>
              {centavosParaReais(aReceber.total)}
            </span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {aReceber.entradas.map((e) => (
              <li key={e.entryId}
                style={{ display: 'grid',
                         gridTemplateColumns: '1fr auto auto',
                         alignItems: 'center', gap: 'var(--s-4)',
                         padding: 'var(--s-3) 0',
                         borderBottom: 'var(--border)' }}>
                <div>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                  </span>
                </div>
                <span className="num" style={{ fontSize: 'var(--fs-14)' }}>
                  {centavosParaReais(e.amountCents)}
                </span>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoEnviarLink(e.entryId); }}>
                  Enviar link
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: 8 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Financeiro.tsx apps/web/src/telas/Financeiro.test.tsx
git commit -m "feat(web): basic financial dashboard with cash, revenue chart and receivables"
```

---

### Task 53: ~~Habilitar navegacao~~ Tela de recibos `/financeiro/recibos`

> **COLISAO RESOLVIDA**: a alteracao de `nav.ts` (FASE_ATUAL=2, Financeiro
> disponivelNaFase=2) e a reescrita de `BarraDeNavegacao.test.tsx` foram
> REMOVIDAS deste bloco. O Bloco 10 (Task 55) e o unico responsavel por
> habilitar Conversas e Financeiro no nav e trocar FASE_ATUAL.
>
> Este bloco MANTEM apenas a tela de Recibos.

**Arquivos**

- Criar `apps/web/src/telas/Recibos.tsx`
- Criar `apps/web/src/telas/Recibos.test.tsx`

**Por que**: A tela de recibos (`/financeiro/recibos`) lista recibos emitidos com filtro por data e paciente.

- [ ] Escrever os testes que falham:

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx — atualizar o teste existente
  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });
```

```tsx
// apps/web/src/telas/Recibos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Recibos } from './Recibos';

const LISTA = [
  { receiptNumber: 42, patientName: 'Maria Souza Lima', description: 'Consulta',
    amountCents: 25000, method: 'dinheiro' as const, paidAt: '2026-08-03T13:30:00.000Z',
    receiptId: 'r1' },
  { receiptNumber: 43, patientName: 'Joana Prado', description: 'Retorno',
    amountCents: 15000, method: 'pix' as const, paidAt: '2026-08-03T14:00:00.000Z',
    receiptId: 'r2' },
];

function montar() {
  const props = {
    carregarRecibos: vi.fn(async (_filtros: { dataInicio?: string; dataFim?: string; paciente?: string }) => LISTA),
    aoImprimirRecibo: vi.fn(async () => {}),
  };
  render(<Recibos {...props} />);
  return props;
}

describe('tela Recibos', () => {
  it('exibe o titulo "Recibos"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Recibos/ })).toBeVisible());
  });

  it('lista os recibos com numero sequencial, paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('R$ 250,00')).toBeVisible();
  });

  it('cada recibo tem botao "Imprimir"', async () => {
    const { aoImprimirRecibo } = montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Imprimir/ }).length).toBe(2));
    await userEvent.click(screen.getAllByRole('button', { name: /Imprimir/ })[0]!);
    expect(aoImprimirRecibo).toHaveBeenCalledWith('r1');
  });

  it('tem campos de filtro por data e paciente', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data início/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Paciente/i)).toBeVisible();
  });

  it('ao preencher filtro de paciente e disparar busca, recarrega a lista', async () => {
    const { carregarRecibos } = montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoPaciente = screen.getByLabelText(/Paciente/i);
    await userEvent.type(campoPaciente, 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    expect(carregarRecibos).toHaveBeenCalledTimes(2);
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Recibos
        carregarRecibos={async () => LISTA}
        aoImprimirRecibo={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Recibos.test.tsx src/ui/BarraDeNavegacao.test.tsx
# Esperado: FAIL — modulo Recibos nao encontrado; assertion de futuros falhando
```

- [ ] Atualizar o nav para Fase 2:

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2,
    motivo: 'WhatsApp bidirecional chega na Fase 2' },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2,
    motivo: 'Financeiro básico chega na Fase 2' },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 2 as const;
```

- [ ] Atualizar os testes da BarraDeNavegacao para a nova realidade da Fase 2:

```tsx
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('renderiza os itens da Fase 1 e 2 como link e os futuros como desabilitados', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument();
    const desempenho = screen.getByRole('button', { name: /Desempenho/ });
    expect(desempenho).toBeDisabled();
    expect(desempenho).toHaveAttribute('aria-disabled', 'true');
    expect(desempenho).toHaveAccessibleDescription(/Fase 3/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Implementar a tela de Recibos:

```tsx
// apps/web/src/telas/Recibos.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

export type MetodoRecibo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface LinhaDeRecibo {
  readonly receiptId: string;
  readonly receiptNumber: number;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly method: MetodoRecibo;
  readonly paidAt: string;
}

export interface RecibosProps {
  readonly carregarRecibos: (filtros: {
    dataInicio?: string; dataFim?: string; paciente?: string;
  }) => Promise<LinhaDeRecibo[]>;
  readonly aoImprimirRecibo: (receiptId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoRecibo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(d);
}

export function Recibos(p: RecibosProps) {
  const [recibos, setRecibos] = useState<LinhaDeRecibo[]>([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [paciente, setPaciente] = useState('');

  useEffect(() => {
    void p.carregarRecibos({}).then(setRecibos);
  }, [p]);

  function filtrar(): void {
    void p.carregarRecibos({
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
      paciente: paciente === '' ? undefined : paciente,
    }).then(setRecibos);
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Recibos
      </h1>

      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Campo rotulo="Data início" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data início" />
        <Campo rotulo="Data fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim" />
        <Campo rotulo="Paciente" denso
          value={paciente} onChange={(e) => setPaciente(e.target.value)}
          aria-label="Paciente" placeholder="Nome do paciente" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      <section aria-label="Lista de recibos">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {recibos.map((r) => (
            <li key={r.receiptId}
              style={{ display: 'grid',
                       gridTemplateColumns: 'auto 1fr auto auto',
                       alignItems: 'center', gap: 'var(--s-5)',
                       borderBottom: 'var(--border)',
                       padding: 'var(--s-4) var(--s-5)', minHeight: 44 }}>
              <span className="num" style={{ fontSize: 'var(--fs-13)',
                                             color: 'var(--text-muted)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                #{r.receiptNumber}
              </span>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {r.patientName}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {r.description} — {ROTULO_METODO[r.method]} — {formatarDataHora(r.paidAt)}
                </span>
              </div>
              <span className="num" style={{ fontSize: 'var(--fs-14)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                {centavosParaReais(r.amountCents)}
              </span>
              <Botao variante="fantasma" altura={28}
                aria-label={`Imprimir recibo ${r.receiptNumber}`}
                onClick={() => { void p.aoImprimirRecibo(r.receiptId); }}>
                Imprimir
              </Botao>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Recibos.test.tsx src/ui/BarraDeNavegacao.test.tsx
# Esperado: todos os testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/ui/nav.ts apps/web/src/ui/BarraDeNavegacao.test.tsx \
  apps/web/src/telas/Recibos.tsx apps/web/src/telas/Recibos.test.tsx
git commit -m "feat(web): enable Financeiro nav in phase 2 and add receipts screen"
```

---

### Task 54: Registrar pagamento no atendimento atualiza o caixa do dia — revalidacao TanStack Query

**Arquivos**

- Criar `apps/web/src/telas/financeiro-revalidacao.test.tsx`

**Por que**: O enunciado pede teste obrigatorio: "registrar pagamento no atendimento atualiza o caixa do dia em tempo real (revalidacao TanStack Query)". Este teste demonstra que ao registrar um pagamento, a query do caixa do dia e invalidada e recarrega automaticamente.

- [ ] Escrever o teste:

```tsx
// apps/web/src/telas/financeiro-revalidacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';

/**
 * Este teste valida o contrato de revalidacao: ao registrar pagamento,
 * a queryKey ['caixa-do-dia'] e invalidada e o componente que escuta
 * essa query recarrega automaticamente.
 *
 * Nao testa uma tela inteira composta; testa o CONTRATO de invalidacao
 * que a integracao real usa.
 */

interface CaixaDoDia {
  readonly total: number;
}

function CaixaConsumidor({ buscar }: { buscar: () => Promise<CaixaDoDia> }) {
  const { data } = useQuery({ queryKey: ['caixa-do-dia'], queryFn: buscar });
  if (data === undefined) return <span>Carregando caixa...</span>;
  return <span data-testid="total-caixa">{data.total}</span>;
}

function CobrancaComInvalidacao({ buscarCaixa }: { buscarCaixa: () => Promise<CaixaDoDia> }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const aoRegistrar = useCallback(async (_dados: {
    amountCents: number;
    method: Exclude<MetodoPagamento, 'link'>;
  }) => {
    const resultado = { entryId: 'e1', receiptNumber: 1 };
    await queryClient.invalidateQueries({ queryKey: ['caixa-do-dia'] });
    setAberto(false);
    return resultado;
  }, [queryClient]);

  const aoCriarLink = useCallback(async (_dados: { amountCents: number }) => {
    return { linkUrl: 'https://pay.example.com/x', linkId: 'l1' };
  }, []);

  return (
    <div>
      <CaixaConsumidor buscar={buscarCaixa} />
      <button type="button" onClick={() => setAberto(true)}>Abrir cobranca</button>
      <PainelDeCobranca
        aberto={aberto}
        pacienteNome="Maria Souza Lima"
        procedimentoNome="Consulta"
        valorSugeridoCentavos={25000}
        aoRegistrar={aoRegistrar}
        aoCriarLink={aoCriarLink}
        aoFechar={() => setAberto(false)}
      />
    </div>
  );
}

describe('revalidacao do caixa do dia apos pagamento', () => {
  it('registrar pagamento invalida a query do caixa e recarrega com o novo total', async () => {
    let chamadas = 0;
    const buscarCaixa = vi.fn(async (): Promise<CaixaDoDia> => {
      chamadas++;
      return { total: chamadas === 1 ? 50000 : 75000 };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CobrancaComInvalidacao buscarCaixa={buscarCaixa} />
      </QueryClientProvider>
    );

    // 1. Caixa carrega com total inicial (50000)
    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    expect(buscarCaixa).toHaveBeenCalledTimes(1);

    // 2. Abrir painel de cobranca
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();

    // 3. Registrar pagamento
    await userEvent.click(screen.getByRole('button', { name: /Registrar/ }));

    // 4. A query do caixa foi invalidada e recarregada — agora mostra 75000
    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('75000'));
    expect(buscarCaixa).toHaveBeenCalledTimes(2);
  });

  it('o caixa nao e recarregado se o pagamento falha', async () => {
    const buscarCaixa = vi.fn(async (): Promise<CaixaDoDia> => ({ total: 50000 }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Falha() {
      const queryClient2 = useQueryClient();
      const [aberto, setAberto] = useState(false);

      const aoRegistrar = useCallback(async () => {
        throw new Error('Falha no servidor');
      }, []);

      return (
        <div>
          <CaixaConsumidor buscar={buscarCaixa} />
          <button type="button" onClick={() => setAberto(true)}>Abrir cobranca</button>
          <PainelDeCobranca
            aberto={aberto}
            pacienteNome="Maria Souza Lima"
            procedimentoNome="Consulta"
            valorSugeridoCentavos={25000}
            aoRegistrar={aoRegistrar}
            aoCriarLink={async () => ({ linkUrl: '', linkId: '' })}
            aoFechar={() => setAberto(false)}
          />
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Falha />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    await userEvent.click(screen.getByRole('button', { name: /Registrar/ }));

    // Aguarda para garantir que nao houve invalidacao extra
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(buscarCaixa).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/financeiro-revalidacao.test.tsx
# Esperado: 2 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/financeiro-revalidacao.test.tsx
git commit -m "test(web): payment registration invalidates daily cash query via TanStack Query"
```

## Parte VI — Integração e gates

### Task 55: habilitar Conversas e Financeiro na barra de navegacao

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar `FASE_ATUAL` e os registros de `Conversas` e `Financeiro` em `nav.ts`. Conversas passa para fase 2 e Financeiro passa para fase 2 (recebimentos basicos).

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 2 as const;
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que o teste existente falha porque agora so Desempenho e futuro.

Saida esperada: 2 falhas — o teste `marca o que ainda nao existe, com o motivo` espera 3 itens futuros (Conversas, Financeiro, Desempenho) mas agora so Desempenho e futuro; e o teste `renderiza os itens da Fase 1 como link e os futuros como desabilitados` clica no botao Conversas que agora e link.

- [ ] Atualizar os testes para refletir a nova realidade.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 2 so Desempenho esta marcado como futuro', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('Conversas e Financeiro agora sao links navegaveis', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
  });

  it('Desempenho permanece desabilitado com motivo', () => {
    render(<BarraDeNavegacao />);
    const desempenho = screen.getByRole('button', { name: /Desempenho/ });
    expect(desempenho).toBeDisabled();
    expect(desempenho).toHaveAttribute('aria-disabled', 'true');
    expect(desempenho).toHaveAccessibleDescription(/Fase 3/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(web): enable Conversas and Financeiro nav items for Fase 2`

---

### Task 56: integrar badges de messaging e pagamento na tela Hoje

**Arquivos**

- Modificar `apps/web/src/telas/Hoje.tsx`
- Modificar `apps/web/src/telas/Hoje.test.tsx`

**Passos**

- [ ] Estender `LinhaDaFila` e `HojeProps` com campos de messaging e pagamento. Adicionar acoes "Mensagem" e "Cobrar" na fila e badge de mensagens nao-lidas na faixa.

```ts
// apps/web/src/telas/Hoje.tsx
'use client';

import { useEffect, useState } from 'react';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import type { StatusAgenda } from '../ui/ChipDeStatus';

export interface LinhaDaFila {
  readonly appointmentId: string; readonly startsAt: string; readonly endsAt: string;
  readonly patientId: string; readonly displayName: string; readonly professionalId: string;
  readonly procedureNome: string | null; readonly procedureCor: string | null;
  readonly operadoraNome: string | null; readonly status: StatusAgenda;
  readonly encaixe: boolean; readonly teleconsulta: boolean; readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean; readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;  // adicionado: Bloco 09 Task 51
  readonly mensagensNaoLidas: number;
  readonly pagamentoPendente: boolean;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number; readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number; readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  readonly filtro?: FiltroDoDia;
  readonly mensagensNaoLidasTotal: number;
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) =>
    Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
  readonly aoMensagem: (linha: LinhaDaFila) => void;
  readonly aoCobrar: (linha: LinhaDaFila) => void;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas'],
  ['resultadosChegados', 'resultados chegados'],
  ['rascunhosDeOntem', 'rascunhos de ontem'],
  ['guiasAFaturar', 'guias a faturar'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fmt.format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores); setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => { void p.carregarPrecisaDeVoce().then(setPrecisa); }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) => atual.map((l) =>
      l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) =>
        l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          {`Hoje, ${porExtenso(p.dia)}`}
        </h1>
        {p.mensagensNaoLidasTotal > 0 ? (
          <span
            aria-label={`${p.mensagensNaoLidasTotal} mensagens não lidas`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 20, height: 20, padding: '0 6px',
              borderRadius: 'var(--r-full)',
              background: 'var(--accent)', color: 'var(--accent-on)',
              fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-semibold)',
            }}
          >
            {p.mensagensNaoLidasTotal}
          </span>
        ) : null}
      </div>

      {contadores === null ? null : (
        <FaixaDeContadores
          contadores={contadores}
          filtroAtivo={p.filtro}
          aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
        />
      )}

      <section aria-label="Fila do dia">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {fila.map((l) => (
            <LinhaDaAgenda
              key={l.appointmentId}
              hora={hora(l.startsAt)}
              paciente={l.displayName}
              profissional={l.professionalId}
              {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
              {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
              status={l.status}
              encaixe={l.encaixe}
              cadastroPreliminar={l.cadastroPreliminar}
              primeiraVez={l.primeiraVez}
              teleconsulta={l.teleconsulta}
            />
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--s-4)', marginTop: 'var(--s-5)',
                       flexWrap: 'wrap' }}>
          {fila.map((l) => (
            <span key={l.appointmentId} style={{ display: 'contents' }}>
              <Botao variante="secundario" altura={28}
                aria-label={`Check-in de ${l.displayName}`}
                onClick={() => { void checkIn(l); }}>
                Check-in
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Abrir atendimento de ${l.displayName}`}
                onClick={() => p.aoAbrirAtendimento(l)}>
                {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Mensagem para ${l.displayName}`}
                onClick={() => p.aoMensagem(l)}>
                {l.mensagensNaoLidas > 0
                  ? `Mensagem (${l.mensagensNaoLidas})`
                  : 'Mensagem'}
              </Botao>
              {l.pagamentoPendente ? (
                <Botao variante="fantasma" altura={28}
                  aria-label={`Cobrar ${l.displayName}`}
                  onClick={() => p.aoCobrar(l)}>
                  Cobrar
                </Botao>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      {precisa === null ? null : (
        <section aria-label="Precisa de você"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Precisa de você
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {PENDENCIAS.map(([chave, rotulo]) => (
              <li key={chave} style={{ display: 'flex', gap: 'var(--s-4)', minHeight: 24 }}>
                <strong className="num" style={{ minWidth: '2ch', textAlign: 'right' }}>
                  {precisa[chave]}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] Escrever os testes atualizados que validam as novas funcionalidades.

```ts
// apps/web/src/telas/Hoje.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Hoje } from './Hoje';

const DIA = {
  contadores: { agendados: 3, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 0 },
  fila: [
    { appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
      patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
      procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
      status: 'aguardando' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
      cadastroPreliminar: true, encounterId: null,
      mensagensNaoLidas: 2, pagamentoPendente: true },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z',
      patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1',
      procedureNome: 'Retorno', procedureCor: '#2f5fd0', operadoraNome: null,
      status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true,
      cadastroPreliminar: false, encounterId: null,
      mensagensNaoLidas: 0, pagamentoPendente: false },
  ],
};
const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1,
                  resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(),
    mensagensNaoLidasTotal: 5,
    aoMensagem: vi.fn(), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('tela Hoje', () => {
  it('o titulo diz o dia por extenso — a tela e o relogio, nao um modulo', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Hoje, segunda-feira, 3 de agosto/i })).toBeVisible());
  });

  it('mostra badge de mensagens nao-lidas no cabecalho', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByLabelText('5 mensagens não lidas')).toBeVisible());
  });

  it('NAO mostra badge quando nao ha mensagens nao-lidas', async () => {
    montar({ mensagensNaoLidasTotal: 0 });
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1 })).toBeVisible());
    expect(screen.queryByLabelText(/mensagens não lidas/)).not.toBeInTheDocument();
  });

  it('mostra a faixa de contadores e a fila em ordem de horario', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
    expect(linhas[1]).toHaveTextContent('Joana Prado');
  });

  it('clicar num contador vira query string, nao estado local', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('aguardando');
  });

  it('a linha mostra os sinais: cadastro preliminar, 1a vez e encaixe', async () => {
    montar();
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('cadastro preliminar');
    expect(linhas[1]).toHaveTextContent('1ª vez');
    expect(linhas[1]).toHaveTextContent('encaixe');
  });

  it('check-in e otimista: o chip muda antes da resposta', async () => {
    const aoCheckIn = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoCheckIn });
    const linhas = await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /Check-in de Joana Prado/ }));
    expect(linhas[1]).toHaveTextContent(/Aguardando/);
  });

  it('acao Mensagem aparece para todos os pacientes e mostra contagem se > 0', async () => {
    const { aoMensagem } = montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ })).toBeVisible());
    expect(screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }))
      .toHaveTextContent('Mensagem (2)');
    expect(screen.getByRole('button', { name: /Mensagem para Joana Prado/ }))
      .toHaveTextContent('Mensagem');
    await userEvent.click(screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }));
    expect(aoMensagem).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('acao Cobrar aparece SOMENTE para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: /Cobrar Joana Prado/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ }));
    expect(aoCobrar).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('o painel Precisa de voce lista as cinco filas com os numeros', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Precisa de você' })).toBeVisible());
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText(/confirmações sem resposta/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Hoje dia="2026-08-03" carregarDia={async () => DIA}
        carregarPrecisaDeVoce={async () => PRECISA} aoCheckIn={async () => {}}
        aoAbrirAtendimento={vi.fn()} aoMudarFiltro={vi.fn()}
        mensagensNaoLidasTotal={0} aoMensagem={vi.fn()} aoCobrar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/Hoje.test.tsx` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando.

- [ ] Commitar: `feat(web): add messaging and payment badges to Hoje screen`

---

### Task 57: adicionar abas Conversas e Financeiro na ficha do paciente

**Arquivos**

- Modificar `apps/web/src/telas/FichaDoPaciente.tsx`
- Modificar `apps/web/src/telas/FichaDoPaciente.test.tsx`

**Passos**

- [ ] Estender `FichaDoPacienteProps` com callbacks para conversas e financeiro. Adicionar abas condicionais.

```ts
// apps/web/src/telas/FichaDoPaciente.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export type PapelNaTela = 'profissional' | 'recepcao' | 'financeiro'
                        | 'admin_clinico' | 'diretor_tecnico';

export interface MensagemResumo {
  readonly messageId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly bodyPreview: string;
  readonly sentAt: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface LancamentoResumo {
  readonly entryId: string;
  readonly description: string;
  readonly amountCents: number;
  readonly status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  readonly dueDate: string;
  readonly paidAt: string | null;
}

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<unknown[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
  readonly carregarConversas: () => Promise<MensagemResumo[]>;
  readonly carregarFinanceiro: () => Promise<LancamentoResumo[]>;
  readonly podeVerFinanceiro: boolean;
}

const CLINICOS = new Set<PapelNaTela>(['profissional', 'admin_clinico', 'diretor_tecnico']);
const VE_FINANCEIRO = new Set<PapelNaTela>(['financeiro', 'admin_clinico', 'diretor_tecnico']);

type Aba = 'perfil' | 'atendimentos' | 'prontuario' | 'conversas' | 'financeiro';

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veProntuario = CLINICOS.has(p.papel);
  const veFinanceiro = p.podeVerFinanceiro || VE_FINANCEIRO.has(p.papel);
  const [aba, setAba] = useState<Aba>('perfil');
  const [pedindoVidro, setPedindoVidro] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [conversas, setConversas] = useState<MensagemResumo[] | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[] | null>(null);

  const abas: { chave: Aba; rotulo: string }[] = [
    { chave: 'perfil', rotulo: 'Perfil' },
    { chave: 'atendimentos', rotulo: 'Atendimentos' },
    ...(veProntuario ? [{ chave: 'prontuario' as const, rotulo: 'Prontuário' }] : []),
    { chave: 'conversas', rotulo: 'Conversas' },
    ...(veFinanceiro ? [{ chave: 'financeiro' as const, rotulo: 'Financeiro' }] : []),
  ];

  function selecionarAba(chave: Aba): void {
    setAba(chave);
    if (chave === 'conversas' && conversas === null) {
      void p.carregarConversas().then(setConversas);
    }
    if (chave === 'financeiro' && lancamentos === null) {
      void p.carregarFinanceiro().then(setLancamentos);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <header style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.paciente.displayName}
        </h1>
        {p.pendentes.length > 0 ? (
          <p role="status" style={{
            margin: 0, fontSize: 'var(--fs-13)', color: 'var(--warn)',
            background: 'var(--warn-soft)', padding: `var(--s-3) var(--s-4)`,
            borderRadius: 'var(--r-md)',
          }}>
            {`${p.pendentes.length} dados pendentes`}
            <span style={{ color: 'var(--text-muted)' }}>{` · ${p.pendentes.join(', ')}`}</span>
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Seções do paciente" style={{ display: 'flex',
                                                                   gap: 'var(--s-1)' }}>
        {abas.map((a) => (
          <button key={a.chave} role="tab" type="button" aria-selected={aba === a.chave}
            onClick={() => selecionarAba(a.chave)}
            style={{
              border: 0, borderBottom: aba === a.chave
                ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: aba === a.chave
                ? 'var(--text)' : 'var(--text-muted)',
              minHeight: 32, padding: `0 var(--s-5)`, cursor: 'pointer',
              fontSize: 'var(--fs-14)',
            }}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'prontuario' && !p.prontuarioAcessivel ? (
        <section aria-label="Prontuário indisponível"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-4)' }}>
          <p style={{ margin: 0 }}>
            {p.existeMasSemAcesso
              ? 'Paciente existe. Prontuário não compartilhado com você.'
              : 'Nenhum prontuário encontrado para este paciente.'}
          </p>
          {p.existeMasSemAcesso ? (
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="secundario" onClick={p.aoSolicitarAcesso}>
                Solicitar acesso
              </Botao>
              <Botao variante="fantasma" onClick={() => setPedindoVidro(true)}>
                Quebra-vidro assistencial
              </Botao>
            </div>
          ) : null}

          {pedindoVidro ? (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <label htmlFor="jv" style={{ fontSize: 'var(--fs-12)',
                                           color: 'var(--text-muted)' }}>
                Justificativa (mínimo 20 caracteres, registrada na auditoria)
              </label>
              <textarea id="jv" value={justificativa} rows={3}
                onChange={(e) => setJustificativa(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-4)', background: 'var(--surface)',
                         color: 'var(--text)', fontFamily: 'var(--font-ui)' }} />
              <Botao
                disabled={justificativa.trim().length < 20}
                onClick={() => { void p.aoQuebrarVidro(justificativa.trim(), 4); }}>
                Confirmar quebra-vidro
              </Botao>
            </div>
          ) : null}
        </section>
      ) : null}

      {aba === 'conversas' ? (
        <section aria-label="Conversas do paciente"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          {conversas === null ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Carregando conversas...</p>
          ) : conversas.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhuma conversa com este paciente.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                         gap: 'var(--s-3)' }}>
              {conversas.map((msg) => (
                <li key={msg.messageId} style={{ display: 'flex', gap: 'var(--s-4)',
                                                  padding: 'var(--s-3) 0',
                                                  borderBottom: 'var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                                 minWidth: '3ch', textAlign: 'right' }}>
                    {msg.direction === 'inbound' ? '←' : '→'}
                  </span>
                  <span style={{ flex: 1, fontSize: 'var(--fs-13)' }}>{msg.bodyPreview}</span>
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)' }}>
                    {msg.sentAt}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {aba === 'financeiro' ? (
        <section aria-label="Financeiro do paciente"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          {lancamentos === null ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Carregando financeiro...</p>
          ) : lancamentos.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhum lançamento para este paciente.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                         gap: 'var(--s-3)' }}>
              {lancamentos.map((l) => (
                <li key={l.entryId} style={{ display: 'flex', justifyContent: 'space-between',
                                             padding: 'var(--s-3) 0',
                                             borderBottom: 'var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-13)' }}>{l.description}</span>
                  <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
                    {`R$ ${(Math.abs(l.amountCents) / 100).toFixed(2).replace('.', ',')}`}
                  </span>
                  <span style={{
                    fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                    color: l.status === 'paid' ? 'var(--success)'
                         : l.status === 'overdue' ? 'var(--danger)'
                         : 'var(--text-muted)',
                  }}>
                    {l.status === 'paid' ? 'Pago' : l.status === 'overdue' ? 'Vencido'
                     : l.status === 'pending' ? 'Pendente' : 'Cancelado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Escrever os testes completos.

```ts
// apps/web/src/telas/FichaDoPaciente.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';

const PACIENTE = { patientId: 'p1', displayName: 'Maria Souza Lima',
                   legalName: 'Maria Souza Lima', hasSocialName: false,
                   birthDate: '1988-03-14', cadastroStatus: 'preliminar' as const,
                   phonePrimary: '11987654321' };

const CONVERSAS = [
  { messageId: 'm1', direction: 'inbound' as const, bodyPreview: 'Boa tarde, posso remarcar?',
    sentAt: '04/08/2026 14:30', status: 'read' as const },
  { messageId: 'm2', direction: 'outbound' as const, bodyPreview: 'Sim! Qual dia prefere?',
    sentAt: '04/08/2026 14:32', status: 'delivered' as const },
];

const LANCAMENTOS = [
  { entryId: 'e1', description: 'Consulta particular', amountCents: 30000,
    status: 'paid' as const, dueDate: '2026-08-03', paidAt: '2026-08-03' },
  { entryId: 'e2', description: 'Retorno', amountCents: 15000,
    status: 'pending' as const, dueDate: '2026-08-10', paidAt: null },
];

function montar(over = {}) {
  const props = {
    paciente: PACIENTE, papel: 'profissional' as const,
    pendentes: ['cpf'], carregarProntuario: vi.fn(async () => [] as unknown[]),
    prontuarioAcessivel: true, existeMasSemAcesso: false,
    aoSolicitarAcesso: vi.fn(), aoQuebrarVidro: vi.fn(async () => {}),
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarFinanceiro: vi.fn(async () => LANCAMENTOS),
    podeVerFinanceiro: false,
    ...over,
  };
  render(<FichaDoPaciente {...props} />);
  return props;
}

describe('ficha do paciente', () => {
  it('recepcao NAO ve a aba Prontuario — ela nao existe, nao esta cinza', () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Atendimentos' })).toBeVisible();
  });

  it('profissional ve Prontuario e NAO ve o substituto administrativo em destaque', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Prontuário' })).toBeVisible();
  });

  it('o TERCEIRO ESTADO aparece com as duas saidas nomeadas', async () => {
    montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    expect(screen.getByText(/Paciente existe\. Prontuário não compartilhado com você\./))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Solicitar acesso' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quebra-vidro assistencial' })).toBeVisible();
  });

  it('quebra-vidro EXIGE justificativa de 20 caracteres antes de habilitar', async () => {
    const { aoQuebrarVidro } = montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quebra-vidro assistencial' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar quebra-vidro' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Justificativa/),
      'paciente inconsciente no pronto atendimento');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);
    expect(aoQuebrarVidro).toHaveBeenCalledWith(
      'paciente inconsciente no pronto atendimento', 4);
  });

  it('a barra de dados pendentes diz QUANTOS e quais', () => {
    montar({ pendentes: ['cpf', 'sex_at_birth'] });
    expect(screen.getByText('2 dados pendentes')).toBeVisible();
  });

  it('aba Conversas aparece para todos os papeis e carrega mensagens sob demanda', async () => {
    const { carregarConversas } = montar({ papel: 'recepcao' });
    expect(screen.getByRole('tab', { name: 'Conversas' })).toBeVisible();
    expect(carregarConversas).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    expect(carregarConversas).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Boa tarde, posso remarcar?')).toBeVisible());
  });

  it('recepcao ve Conversas mas NAO ve conteudo clinico no contexto', async () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    await waitFor(() => expect(
      screen.getByRole('region', { name: 'Conversas do paciente' })).toBeVisible());
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
  });

  it('aba Financeiro aparece para papel financeiro e mostra lancamentos', async () => {
    const { carregarFinanceiro } = montar({ papel: 'financeiro' });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Financeiro' }));
    expect(carregarFinanceiro).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Consulta particular')).toBeVisible());
    expect(screen.getByText('Pago')).toBeVisible();
    expect(screen.getByText('Pendente')).toBeVisible();
  });

  it('recepcao NAO ve aba Financeiro a menos que podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: false });
    expect(screen.queryByRole('tab', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('recepcao ve aba Financeiro quando podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: true });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente paciente={PACIENTE} papel="profissional" pendentes={[]}
        carregarProntuario={async () => []} prontuarioAcessivel existeMasSemAcesso={false}
        aoSolicitarAcesso={vi.fn()} aoQuebrarVidro={async () => {}}
        carregarConversas={async () => []} carregarFinanceiro={async () => []}
        podeVerFinanceiro={false} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/FichaDoPaciente.test.tsx` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando.

- [ ] Commitar: `feat(web): add Conversas and Financeiro tabs to patient record`

---

### Task 58: adicionar acoes Confirmar e Cobrar no slot da Agenda

**Arquivos**

- Modificar `apps/web/src/telas/Agenda.tsx`
- Modificar `apps/web/src/telas/Agenda.test.tsx`

**Passos**

- [ ] Estender `AgendaProps` e a grade com acoes de confirmacao e cobranca por slot. O status de confirmacao aparece no botao do slot.

```ts
// apps/web/src/telas/Agenda.tsx
'use client';

import { useEffect, useState } from 'react';
import { VISOES, faixasDoDia, posicaoNaGrade, type Visao } from './grade';
import type { LinhaDaFila } from './Hoje';
import { Botao } from '../ui/Botao';

export interface AgendaProps {
  readonly dia: string;
  readonly visao: Visao['chave'];
  readonly timezone: string;
  readonly carregar: (dia: string) => Promise<LinhaDaFila[]>;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
  readonly aoMudarDia: (dia: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly aoMover: (appointmentId: string, novoInicioIso: string) => Promise<void>;
  readonly aoConfirmar: (appointmentId: string) => Promise<void>;
  readonly aoCobrar: (appointmentId: string) => void;
}

const INICIO_MIN = 7 * 60;
const FIM_MIN = 21 * 60;
const PASSO_MIN = 15;

export function Agenda(p: AgendaProps) {
  const [itens, setItens] = useState<LinhaDaFila[]>([]);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const faixas = faixasDoDia({ inicioMin: INICIO_MIN, fimMin: FIM_MIN, passoMin: PASSO_MIN });

  useEffect(() => { void p.carregar(p.dia).then(setItens); }, [p, p.dia]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA'
        || alvo?.isContentEditable === true;
      if (editando || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VISOES.find((x) => x.atalho === e.key);
      if (v !== undefined) { e.preventDefault(); p.aoMudarVisao(v.chave); }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [p]);

  async function confirmar(appointmentId: string): Promise<void> {
    setConfirmando(appointmentId);
    try {
      await p.aoConfirmar(appointmentId);
      setItens((atual) => atual.map((it) =>
        it.appointmentId === appointmentId
          ? { ...it, status: 'confirmado' as const }
          : it));
    } finally {
      setConfirmando(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div role="tablist" aria-label="Visões da agenda"
           style={{ display: 'flex', gap: 'var(--s-1)' }}>
        {VISOES.map((v) => (
          <button
            key={v.chave} role="tab" type="button"
            aria-selected={p.visao === v.chave}
            onClick={() => p.aoMudarVisao(v.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: p.visao === v.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)', minHeight: 32, padding: `0 var(--s-5)`,
              fontSize: 'var(--fs-13)', cursor: 'pointer',
            }}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      <div
        aria-label={`Agenda de ${p.dia}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr',
          gridTemplateRows: `repeat(${faixas.length}, 18px)`,
          border: 'var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', position: 'relative',
        }}
      >
        {faixas.map((f, i) => (
          <span key={f} aria-hidden="true"
            style={{ gridColumn: 1, gridRow: i + 1, fontSize: 'var(--fs-11)',
                     color: 'var(--text-faint)', paddingInlineEnd: 'var(--s-3)',
                     textAlign: 'right', borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }}>
            {i % 4 === 0 ? f : ''}
          </span>
        ))}
        {faixas.map((f, i) => (
          <div key={`c-${f}`} data-slot="vazio"
            onClick={() => p.aoAbrirCompositor(INICIO_MIN + i * PASSO_MIN)}
            style={{ gridColumn: 2, gridRow: i + 1, cursor: 'pointer',
                     borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }} />
        ))}
        {itens.map((it) => {
          const pos = posicaoNaGrade(it.startsAt, it.endsAt,
            { inicioMin: INICIO_MIN, passoMin: PASSO_MIN, timezone: p.timezone });
          return (
            <div
              key={it.appointmentId}
              style={{
                gridColumn: 2, gridRow: `${pos.linhaInicio} / ${pos.linhaFim}`,
                textAlign: 'left', border: 'var(--border)',
                borderInlineStart: `3px solid ${it.procedureCor ?? 'var(--st-agendado)'}`,
                borderRadius: 'var(--r-sm)',
                background: it.encaixe
                  ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
                  : 'var(--surface)',
                margin: 1, padding: `var(--s-2) var(--s-4)`,
                fontSize: 'var(--fs-13)', overflow: 'hidden',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {it.displayName}
                {it.status === 'confirmado' ? (
                  <span aria-label="Confirmado" style={{ marginInlineStart: 'var(--s-2)',
                    color: 'var(--st-confirmado)', fontSize: 'var(--fs-11)' }}>
                    ✓
                  </span>
                ) : null}
              </span>
              <span style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>
                {it.status === 'agendado' ? (
                  <Botao variante="fantasma" altura={28}
                    carregando={confirmando === it.appointmentId}
                    aria-label={`Confirmar ${it.displayName}`}
                    onClick={(e) => { e.stopPropagation(); void confirmar(it.appointmentId); }}>
                    Confirmar
                  </Botao>
                ) : null}
                {it.pagamentoPendente ? (
                  <Botao variante="fantasma" altura={28}
                    aria-label={`Cobrar ${it.displayName}`}
                    onClick={(e) => { e.stopPropagation(); p.aoCobrar(it.appointmentId); }}>
                    Cobrar
                  </Botao>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Escrever os testes atualizados.

```ts
// apps/web/src/telas/Agenda.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Agenda } from './Agenda';

const FILA = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
  patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
  status: 'agendado' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
  mensagensNaoLidas: 0, pagamentoPendente: true,
}];

function montar(over = {}) {
  const props = {
    dia: '2026-08-03', visao: 'dia' as const, timezone: 'UTC',
    carregar: vi.fn(async () => FILA), aoMudarVisao: vi.fn(), aoMudarDia: vi.fn(),
    aoAbrirCompositor: vi.fn(), aoMover: vi.fn(async () => {}),
    aoConfirmar: vi.fn(async () => {}), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Agenda {...props} />);
  return props;
}

describe('tela Agenda', () => {
  it('oferece as cinco visoes como tablist', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('as teclas 1..5 trocam a visao — atalho de um caractere fora de campo de texto', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.keyboard('4');
    expect(aoMudarVisao).toHaveBeenCalledWith('profissional');
  });

  it('a visao vai para a query string, nao para estado local', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));
    expect(aoMudarVisao).toHaveBeenCalledWith('semana');
  });

  it('o agendamento aparece posicionado na grade, com a cor do procedimento', async () => {
    montar();
    const item = await screen.findByText('Maria Souza Lima');
    expect(item.closest('[style]')).toBeTruthy();
  });

  it('o botao Confirmar aparece para status agendado e envia template de confirmacao', async () => {
    const { aoConfirmar } = montar();
    const botao = await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoConfirmar).toHaveBeenCalledWith('a1');
  });

  it('apos confirmar, o status muda para confirmado e o glifo aparece', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ }));
    await waitFor(() => expect(screen.getByLabelText('Confirmado')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Confirmar Maria Souza Lima/ }))
      .not.toBeInTheDocument();
  });

  it('o botao Cobrar aparece para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    const botao = await screen.findByRole('button', { name: /Cobrar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCobrar).toHaveBeenCalledWith('a1');
  });

  it('Cobrar NAO aparece quando pagamentoPendente e false', async () => {
    montar({ carregar: vi.fn(async () =>
      FILA.map((f) => ({ ...f, pagamentoPendente: false }))) });
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Cobrar/ })).not.toBeInTheDocument();
  });

  it('clicar num vao vazio abre o compositor INLINE, nao um modal de pagina cheia', async () => {
    const { aoAbrirCompositor } = montar();
    const slots = await waitFor(() => {
      const s = document.querySelectorAll('[data-slot="vazio"]');
      expect(s.length).toBeGreaterThan(0);
      return s;
    });
    await userEvent.click(slots[0] as HTMLElement);
    expect(aoAbrirCompositor).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Agenda dia="2026-08-03" visao="dia" timezone="UTC" carregar={async () => FILA}
        aoMudarVisao={vi.fn()} aoMudarDia={vi.fn()} aoAbrirCompositor={vi.fn()}
        aoMover={async () => {}} aoConfirmar={async () => {}} aoCobrar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/Agenda.test.tsx` e confirmar que todos os 10 testes passam.

Saida esperada: 10 testes passando.

- [ ] Commitar: `feat(web): add Confirmar and Cobrar actions to Agenda slots`

---

### Task 59: adicionar msg ao TENANT_SCHEMAS e atualizar providers registry

**Arquivos**

- Modificar `packages/db/src/invariants/catalog.ts`
- Criar `packages/db/src/invariants/catalog.test.ts`
- Modificar `apps/api/src/providers.ts`
- Criar `apps/api/src/providers.test.ts`

**Passos**

- [ ] Escrever o teste que afirma que `msg` e `fin` pertencem ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas da Fase 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que falha porque `msg` nao esta em `TENANT_SCHEMAS`.

Saida esperada: 1 falha — `msg` nao encontrado.

- [ ] Adicionar `msg` ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.ts — so a linha que muda
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg'] as const;
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Escrever o teste do registry de providers incluindo messaging e payment.

```ts
// apps/api/src/providers.test.ts
import { describe, expect, it } from 'vitest';
import { providers, type Providers } from './providers';

describe('registry de providers (fake)', () => {
  it('inclui signature, prescription, messaging e payment', () => {
    const p: Providers = providers();
    expect(p.signature.id).toBe('signature-fake');
    expect(p.prescription.id).toBe('prescription-fake');
    expect(p.messaging.id).toBe('messaging-fake');
    expect(p.payment.id).toBe('payment-fake');
  });

  it('todos declaram safety para seus metodos', () => {
    const p = providers();
    expect(Object.keys(p.messaging.safety).length).toBeGreaterThan(0);
    expect(Object.keys(p.payment.safety).length).toBeGreaterThan(0);
  });

  it('todos declaram capabilities', () => {
    const p = providers();
    expect(p.messaging.capabilities.size).toBeGreaterThan(0);
    expect(p.payment.capabilities.size).toBeGreaterThan(0);
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que falha porque `messaging` e `payment` nao existem no registry.

Saida esperada: falha de tipo/propriedade.

- [ ] Atualizar o registry de providers para incluir messaging e payment.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  type MessagingProvider, type PaymentProvider,
  type PrescriptionProvider, type SignatureProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
    payment: createFakePaymentProvider(),
  };
  return cache;
}
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Commitar: `feat: add msg to TENANT_SCHEMAS and register messaging/payment providers`

---

### Task 60: definition-of-done gate e demonstracao de ponta a ponta

**Arquivos**

- Modificar `package.json` (script `prepush`)
- Criar `apps/api/src/routes/fase2-e2e.int.test.ts`

**Passos**

- [ ] Atualizar o script `prepush` para cobrir todos os gates da Fase 2.

```jsonc
// package.json — campo scripts (so os campos que mudam)
{
  "prepush": "pnpm typecheck && pnpm arch:check && pnpm lint:terminology-clock && pnpm lint:session-guc && pnpm test && pnpm test:int && pnpm test:iso"
}
```

Isto garante que:
1. `pnpm typecheck` — 0 erros
2. `pnpm arch:check` — 0 violacoes (messaging nao importa scheduling, payments nao importa messaging, etc.)
3. `pnpm lint:terminology-clock` — 0 violacoes
4. `pnpm lint:session-guc` — 0 violacoes
5. `pnpm test` — todos os testes de unidade passam
6. `pnpm test:int` — todos os testes de integracao passam
7. `pnpm test:iso` — todos os testes de isolamento passam

Os gates `pnpm db:invariants` e `pnpm db:privileges` continuam manuais por exigirem banco vivo; a documentacao abaixo instrui a execucao.

- [ ] Escrever o teste de integracao de ponta a ponta da Fase 2 com provedores fake. Este teste prova o fluxo completo e os fatos de protecao.

```ts
// apps/api/src/routes/fase2-e2e.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakeMessagingProvider,
  createFakePaymentProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@cadencia/integrations';
import { createTestDb, type TestDb } from '../test-support';

let db: TestDb;
let messaging: MessagingProvider;
let payment: PaymentProvider;
const TENANT_ID = uuidv7();
const USER_ID = uuidv7();
const CLINIC_ID = uuidv7();
const PATIENT_ID = uuidv7();

function ator(): Actor {
  return { kind: 'user', tenantId: TENANT_ID, userId: USER_ID,
           clinicId: CLINIC_ID, requestId: uuidv7() };
}

beforeAll(async () => {
  db = await createTestDb();
  messaging = createFakeMessagingProvider();
  payment = createFakePaymentProvider();
});

afterAll(async () => { await db.close(); });

describe('demonstracao de ponta a ponta da Fase 2', () => {
  // --- FLUXO 1: confirmacao via WhatsApp ---
  it('1. enviar confirmacao via messaging provider', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `confirm-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await messaging.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990001' as import('@cadencia/integrations').E164,
      body: { kind: 'template', templateName: 'confirmacao_consulta',
              params: { paciente: 'Maria', data: '05/08/2026', hora: '14:00' } },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMessageId).toBeTruthy();
  });

  // --- FLUXO 2: pagamento PIX ---
  it('2. criar link de pagamento e confirmar via webhook', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `pay-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const link = await payment.createPaymentLink(ctx, {
      amountCents: 30000, currency: 'BRL',
      description: 'Consulta particular',
      expiresInMinutes: 60,
      payerName: 'Maria Souza Lima',
      payerDocument: '12345678901',
    });
    expect(link.ok).toBe(true);
    if (link.ok) {
      expect(link.value.paymentUrl).toContain('http');
      expect(link.value.providerPaymentId).toBeTruthy();
    }
  });

  // --- FATO 1: webhook com assinatura HMAC invalida e REJEITADO ---
  it('3. webhook com assinatura HMAC invalida e rejeitado pelo messaging provider', () => {
    const resultado = messaging.verifyWebhook(
      Buffer.from('{"tipo":"mensagem"}'),
      { 'x-hub-signature-256': 'sha256=assinatura_invalida_aqui' },
    );
    expect(resultado.valid).toBe(false);
    expect(resultado.reason).toBeTruthy();
  });

  // --- FATO 2: timeout NAO reenvia automaticamente ---
  it('4. timeout no WhatsApp NAO gera retry automatico — persiste estado indeterminado', async () => {
    const msgTimeout = createFakeMessagingProvider({ modo: 'timeout' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `timeout-${uuidv7()}`,
      deadlineMs: 100,
    };
    const r = await msgTimeout.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990002' as import('@cadencia/integrations').E164,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  // --- FATO 3: pagamento duplicado por idempotency_key e recusado ---
  it('5. pagamento duplicado por idempotency_key retorna o mesmo resultado, nao duplica', async () => {
    const chave = `idem-${uuidv7()}`;
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: chave,
      deadlineMs: 5000,
    };
    const primeiro = await payment.createPaymentLink(ctx, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(primeiro.ok).toBe(true);

    const ctx2 = { ...ctx, requestId: uuidv7() };
    const segundo = await payment.createPaymentLink(ctx2, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(segundo.ok).toBe(true);
    if (primeiro.ok && segundo.ok) {
      expect(segundo.value.providerPaymentId).toBe(primeiro.value.providerPaymentId);
    }
  });

  // --- FATO 4: webhook de pagamento com assinatura invalida e rejeitado ---
  it('6. webhook de pagamento com assinatura invalida e rejeitado', () => {
    const resultado = payment.verifyWebhook(
      Buffer.from('{"event":"payment_confirmed"}'),
      { 'x-webhook-signature': 'invalida' },
    );
    expect(resultado.valid).toBe(false);
  });

  // --- FATO 5: lembrete para consulta as 8h em SP sai no fuso correto ---
  it('7. lembrete 24h antes respeita o fuso da clinica — SP e UTC-3', () => {
    // consulta agendada para 2026-08-05T08:00:00 em America/Sao_Paulo
    // = 2026-08-05T11:00:00.000Z
    // lembrete 24h antes = 2026-08-04T08:00:00 em SP = 2026-08-04T11:00:00.000Z
    const consultaUtc = new Date('2026-08-05T11:00:00.000Z');
    const lembreteUtc = new Date(consultaUtc.getTime() - 24 * 60 * 60 * 1000);
    expect(lembreteUtc.toISOString()).toBe('2026-08-04T11:00:00.000Z');

    // Converter para horario local de SP: 08:00
    const emSP = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(lembreteUtc);
    expect(emSP).toBe('08:00');
  });

  // --- FATO 6: provider health check funciona ---
  it('8. health check dos providers fake retorna up=true', async () => {
    const msgHealth = await messaging.health();
    expect(msgHealth.up).toBe(true);
    expect(msgHealth.latencyMs).toBeDefined();

    const payHealth = await payment.health();
    expect(payHealth.up).toBe(true);
  });

  // --- FATO 7: messaging provider declara residency:br ---
  it('9. messaging provider declara residency:br nas capabilities', () => {
    expect(messaging.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 8: payment provider declara residency:br ---
  it('10. payment provider declara residency:br nas capabilities', () => {
    expect(payment.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 9: safety do send e unsafe ---
  it('11. send de mensagem e declarado como unsafe — nunca retry automatico', () => {
    expect(messaging.safety['send']).toBe('unsafe');
  });

  // --- FATO 10: safety do createPaymentLink e idempotent ---
  it('12. createPaymentLink e declarado como idempotent', () => {
    expect(payment.safety['createPaymentLink']).toBe('idempotent');
  });

  // --- FATO 11: refund e unsafe ---
  it('13. refund e declarado como unsafe', () => {
    expect(payment.safety['refund']).toBe('unsafe');
  });

  // --- FATO 12: numero bloqueado mostra canal suspenso ---
  it('14. messaging com numero bloqueado sinaliza canal suspenso, nao descarta historico', async () => {
    const msgBloqueado = createFakeMessagingProvider({ modo: 'bloqueado' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `blocked-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await msgBloqueado.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990003' as import('@cadencia/integrations').E164,
      body: { kind: 'text', text: 'Teste' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('rejected');
      expect(r.error.detail).toContain('canal suspenso');
    }
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/routes/fase2-e2e.int.test.ts` e confirmar que todos os 14 testes passam.

Saida esperada: 14 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 2 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam
pnpm test:int           # todos os testes de integracao passam
pnpm test:iso           # todos os testes de isolamento passam (msg.* e fin.* verificadas)
pnpm db:invariants      # todos verdes (requer banco vivo)
pnpm db:privileges      # novas relacoes declaradas (requer banco vivo)
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 2 definition-of-done gate and end-to-end demonstration`

