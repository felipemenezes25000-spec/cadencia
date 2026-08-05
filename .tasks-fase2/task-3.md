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