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

  const eventList: CreatedCalendarEvent[] = [];
  const deletedList: string[] = [];
  let counter = 0;

  return {
    id: 'calendar-fake',
    capabilities: new Set(['residency:br']),
    safety: { createEvent: 'unsafe', deleteEvent: 'unsafe', listCalendars: 'safe' },

    get events(): readonly CreatedCalendarEvent[] {
      return eventList;
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

      counter += 1;
      const externalEventId = `fake-cal-event-${counter}`;
      eventList.push({ ctx, event: input.event, externalEventId });
      return success({ externalEventId }, externalEventId);
    },

    async deleteEvent(_ctx: ProviderCtx, input: { accessToken: string; calendarId: string; externalEventId: string }) {
      const f = falha<Record<string, never>>();
      if (f) return f;

      deletedList.push(input.externalEventId);
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
