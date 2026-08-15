import { createHash } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { CalendarInfo, CalendarProvider } from '../contracts/calendar';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function calendarEventIdFromIdempotencyKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

async function gcalRequest<T>(
  url: string, accessToken: string, ctx: ProviderCtx,
  opts: { method?: string; body?: unknown } = {},
): Promise<ProviderResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.deadlineMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'cadencia/1.0',
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      return failure({ kind: 'unavailable', retrySafe: true, retryAfterMs: 10_000,
        detail: 'rate limit' });
    }
    if (res.status >= 500) {
      return failure({ kind: 'unavailable', retrySafe: true, detail: `gcal ${res.status}` });
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return success({} as T, '');
    }
    const json = await res.json() as T;
    if (!res.ok) {
      const detail = (json as { error?: { message?: string } }).error?.message
        ?? `status ${res.status}`;
      return failure({ kind: 'rejected', retrySafe: false,
        code: `GCAL_${res.status}`, detail });
    }
    return success(json, (json as { id?: string }).id ?? '');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return failure({ kind: 'timeout', retrySafe: false, detail: `deadline ${ctx.deadlineMs}ms` });
    }
    return failure({ kind: 'unavailable', retrySafe: true, detail: msg });
  } finally {
    clearTimeout(timer);
  }
}

export function createGoogleCalendarProvider(): CalendarProvider {
  return {
    id: 'calendar-google',
    capabilities: new Set(['residency:us']),
    safety: {
      createEvent: 'idempotent',
      deleteEvent: 'idempotent',
      listCalendars: 'safe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async createEvent(ctx, input) {
      const ev = input.event;
      const eventId = calendarEventIdFromIdempotencyKey(ctx.idempotencyKey);
      const body = {
        id: eventId,
        summary: ev.summary,
        start: { dateTime: ev.startIso },
        end: { dateTime: ev.endIso },
        ...(ev.description !== undefined ? { description: ev.description } : {}),
      };
      const insert = await gcalRequest<{ id: string }>(
        `${GCAL_BASE}/calendars/${encodeURIComponent(ev.calendarId)}/events`,
        input.accessToken, ctx, { method: 'POST', body },
      );
      if (insert.ok) return success({ externalEventId: insert.value.id }, insert.value.id);
      if (insert.error.code !== 'GCAL_409') return insert;

      // O mesmo ID já existe: é retry OU atualização de horário/status do mesmo
      // agendamento. PUT no recurso determinístico transforma createEvent em
      // upsert sem gerar um segundo compromisso no calendário.
      const update = await gcalRequest<{ id: string }>(
        `${GCAL_BASE}/calendars/${encodeURIComponent(ev.calendarId)}/events/${eventId}`,
        input.accessToken, ctx, { method: 'PUT', body },
      );
      if (!update.ok) return update;
      return success({ externalEventId: update.value.id || eventId }, update.value.id || eventId);
    },

    async deleteEvent(ctx, input) {
      const url = `${GCAL_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.externalEventId)}`;
      const r = await gcalRequest<Record<string, never>>(
        url, input.accessToken, ctx, { method: 'DELETE' });
      if (!r.ok && r.error.code === 'GCAL_404') return success({}, input.externalEventId);
      return r;
    },

    async listCalendars(ctx, input) {
      const r = await gcalRequest<{ items: Array<{ id: string; summary: string }> }>(
        `${GCAL_BASE}/users/me/calendarList`, input.accessToken, ctx,
      );
      if (!r.ok) return r;
      const calendars: CalendarInfo[] = (r.value.items ?? []).map((c) => ({
        id: c.id, name: c.summary,
      }));
      return success({ calendars }, 'calendar-list');
    },
  };
}
