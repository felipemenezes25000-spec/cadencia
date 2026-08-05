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