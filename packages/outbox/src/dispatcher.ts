// packages/outbox/src/dispatcher.ts

/**
 * §7.1 — Despachante do outbox transacional.
 *
 * Lê eventos não despachados, processa via handler registrado, marca
 * dispatched_at em sucesso, incrementa attempts e grava last_error em falha.
 * Backoff exponencial, max 5 tentativas, dead-letter após isso.
 *
 * O despachante é puro: as funções de persistência (markDispatched, markFailed)
 * são injetadas, tornando o núcleo testável sem banco.
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
      // evento sem handler: marca como despachado para não travar a fila
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

      // attempts já conta as tentativas ANTERIORES; esta é a tentativa (attempts + 1)
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        return { status: 'dead_letter', error: message };
      }
      return { status: 'failed', error: message };
    }
  }

  return { dispatch, backoffMs };
}
