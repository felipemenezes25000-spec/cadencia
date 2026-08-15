import { describe, it, expect } from 'vitest';
import { createFakeCalendarProvider } from './calendar-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorUserId: '00000000-0000-0000-0000-000000000002',
  requestId: 'req-1',
  idempotencyKey: 'idem-1',
  deadlineMs: 5000,
};

const evento = {
  calendarId: 'primary',
  summary: 'Consulta Dr. Silva',
  startIso: '2026-08-15T10:00:00.000Z',
  endIso: '2026-08-15T11:00:00.000Z',
};

describe('calendar-fake', () => {
  it('creates event in ok mode', async () => {
    const p = createFakeCalendarProvider();
    const r = await p.createEvent(ctx, { accessToken: 'tok', event: evento });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.externalEventId).toMatch(/^[a-f0-9]{64}$/);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]?.externalEventId).toBe(r.value.externalEventId);
  });

  it('upserts the same external event when an idempotent create is retried', async () => {
    const p = createFakeCalendarProvider();
    const first = await p.createEvent(ctx, { accessToken: 'tok', event: evento });
    const second = await p.createEvent(ctx, {
      accessToken: 'tok',
      event: { ...evento, summary: 'Consulta atualizada' },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.externalEventId).toBe(first.value.externalEventId);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]?.event.summary).toBe('Consulta atualizada');
  });

  it('deletes event', async () => {
    const p = createFakeCalendarProvider();
    const r = await p.deleteEvent(ctx, { accessToken: 'tok', calendarId: 'primary', externalEventId: 'ev-1' });
    expect(r.ok).toBe(true);
    expect(p.deleted).toContain('ev-1');
  });

  it('lists calendars', async () => {
    const p = createFakeCalendarProvider();
    const r = await p.listCalendars(ctx, { accessToken: 'tok' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calendars).toHaveLength(2);
    expect(r.value.calendars[0]!.id).toBe('primary');
  });

  it('returns unavailable in indisponivel mode', async () => {
    const p = createFakeCalendarProvider({ modo: 'indisponivel' });
    const r = await p.createEvent(ctx, { accessToken: 'tok', event: evento });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unavailable');
  });

  it('returns timeout in timeout mode', async () => {
    const p = createFakeCalendarProvider({ modo: 'timeout' });
    const r = await p.createEvent(ctx, { accessToken: 'tok', event: evento });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('timeout');
  });

  it('health returns up:true in ok mode', async () => {
    const p = createFakeCalendarProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health returns up:false in indisponivel mode', async () => {
    const p = createFakeCalendarProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });
});
