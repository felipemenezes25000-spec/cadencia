import type { Provider, ProviderCtx, ProviderResult } from './common';

export interface CalendarEvent {
  readonly calendarId: string;
  readonly summary: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly description?: string;
}

export interface CalendarInfo {
  readonly id: string;
  readonly name: string;
}

export interface CalendarProvider extends Provider {
  createEvent(ctx: ProviderCtx, input: {
    readonly accessToken: string;
    readonly event: CalendarEvent;
  }): Promise<ProviderResult<{ externalEventId: string }>>;

  deleteEvent(ctx: ProviderCtx, input: {
    readonly accessToken: string;
    readonly calendarId: string;
    readonly externalEventId: string;
  }): Promise<ProviderResult<Record<string, never>>>;

  listCalendars(ctx: ProviderCtx, input: {
    readonly accessToken: string;
  }): Promise<ProviderResult<{ calendars: CalendarInfo[] }>>;
}
