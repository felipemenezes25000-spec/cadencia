import { createHash } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { CalendarEvent, CalendarInfo, CalendarProvider } from '../contracts/calendar';

export type ModoFakeCalendar = 'ok' | 'indisponivel' | 'timeout';

export interface FakeCalendarOptions {
  readonly modo?: ModoFakeCalendar;
}

export interface CreatedCalendarEvent {
  readonly ctx: ProviderCtx;
  readonly event: CalendarEvent;
  readonly externalEventId: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

function stableId(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function createFakeCalendarProvider(
  opts: FakeCalendarOptions = {},
): CalendarProvider & { readonly events: readonly CreatedCalendarEvent[]; readonly deleted: readonly string[] } {
  const modo = opts.modo ?? 'ok';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'calendar fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false,
                          detail: 'deadline estourou' });
    }
    return null;
  }

  const byId = new Map<string, CreatedCalendarEvent>();
  const deletedList: string[] = [];

  return {
    id: 'calendar-fake',
    capabilities: new Set(['residency:br']),
    safety: { createEvent: 'idempotent', deleteEvent: 'idempotent', listCalendars: 'safe' },

    get events(): readonly CreatedCalendarEvent[] {
      return [...byId.values()];
    },

    get deleted(): readonly string[] {
      return deletedList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createEvent(ctx: ProviderCtx, input: { accessToken: string; event: CalendarEvent }) {
      const f = falha<{ externalEventId: string }>();
      if (f) return f;

      const externalEventId = stableId(ctx.idempotencyKey);
      byId.set(externalEventId, { ctx, event: input.event, externalEventId });
      return success({ externalEventId }, externalEventId);
    },

    async deleteEvent(_ctx: ProviderCtx, input: { accessToken: string; calendarId: string; externalEventId: string }) {
      const f = falha<Record<string, never>>();
      if (f) return f;

      byId.delete(input.externalEventId);
      if (!deletedList.includes(input.externalEventId)) deletedList.push(input.externalEventId);
      return success({} as Record<string, never>, input.externalEventId);
    },

    async listCalendars(_ctx: ProviderCtx, _input: { accessToken: string }) {
      const f = falha<{ calendars: CalendarInfo[] }>();
      if (f) return f;

      return success({
        calendars: [
          { id: 'primary', name: 'Calendario principal' },
          { id: 'work', name: 'Trabalho' },
        ],
      }, 'fake-calendars');
    },
  };
}
