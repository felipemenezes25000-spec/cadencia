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
    // máximo de 5 minutos
    expect(backoffMs(20)).toBe(300_000);
  });
});
