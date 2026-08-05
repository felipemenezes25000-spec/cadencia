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