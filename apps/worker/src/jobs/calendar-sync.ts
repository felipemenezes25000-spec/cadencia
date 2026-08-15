import { jobsPool } from '@cadencia/db';
import { aes256KeyFromBase64, openSecret, uuidv7 } from '@cadencia/kernel';
import {
  calendarEventIdFromIdempotencyKey,
  type CalendarProvider,
} from '@cadencia/integrations';

export interface CalendarSyncResult {
  readonly usersProcessed: number;
  readonly eventsSynced: number;
  readonly failures: number;
}

export interface CalendarSyncFilter {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly force?: boolean;
}

function tokenKey(): Buffer {
  const raw = process.env['CADENCIA_INTEGRATION_TOKEN_KEY'];
  if (raw === undefined || raw === '') {
    throw new Error('CADENCIA_INTEGRATION_TOKEN_KEY ausente — tokens de calendario nao podem ser lidos');
  }
  return aes256KeyFromBase64(raw, 'CADENCIA_INTEGRATION_TOKEN_KEY');
}

export async function syncCalendars(
  provider: CalendarProvider,
  filter: CalendarSyncFilter = {},
): Promise<CalendarSyncResult> {
  const key = tokenKey();
  const pool = jobsPool();
  const { rows: connections } = await pool.query<{
    id: string; tenant_id: string; user_id: string; provider: string;
    access_token_enc: Buffer; external_id: string | null; last_sync_at: Date | null;
  }>(
    `SELECT * FROM app.calendar_sync_candidates($1::uuid, $2::uuid, $3::boolean)`,
    [filter.tenantId ?? null, filter.userId ?? null, filter.force ?? false],
  );

  let usersProcessed = 0;
  let eventsSynced = 0;
  let failures = 0;

  for (const connection of connections) {
    usersProcessed += 1;
    let accessToken: string;
    try {
      accessToken = openSecret(connection.access_token_enc, key);
    } catch {
      failures += 1;
      continue;
    }

    const { rows: appointments } = await pool.query<{
      id: string; starts_at: Date; ends_at: Date; status: string;
      patient_name: string; clinic_name: string; procedure_name: string | null;
      updated_at: Date;
    }>(
      `SELECT * FROM app.calendar_sync_appointments($1::uuid, $2::uuid, $3::timestamptz)`,
      [connection.tenant_id, connection.user_id, connection.last_sync_at],
    );

    let connectionFailed = false;
    const calendarId = connection.external_id ?? 'primary';

    for (const appt of appointments) {
      const idempotencyKey = `calendar:${connection.id}:${appt.id}`;
      const ctx = {
        tenantId: connection.tenant_id,
        actorUserId: connection.user_id,
        requestId: uuidv7(),
        idempotencyKey,
        deadlineMs: 15_000,
      };

      if (appt.status === 'cancelado') {
        const removed = await provider.deleteEvent(ctx, {
          accessToken,
          calendarId,
          externalEventId: calendarEventIdFromIdempotencyKey(idempotencyKey),
        });
        if (!removed.ok) {
          connectionFailed = true;
          failures += 1;
          break;
        }
        eventsSynced += 1;
        continue;
      }

      const synced = await provider.createEvent(ctx, {
        accessToken,
        event: {
          calendarId,
          summary: `Consulta — ${appt.patient_name}`,
          startIso: appt.starts_at.toISOString(),
          endIso: appt.ends_at.toISOString(),
          description: [appt.clinic_name, appt.procedure_name]
            .filter((v): v is string => v !== null && v !== '')
            .join(' · '),
        },
      });
      if (!synced.ok) {
        connectionFailed = true;
        failures += 1;
        break;
      }
      eventsSynced += 1;
    }

    if (!connectionFailed) {
      // O cursor só avança depois de TODOS os efeitos externos da conexão. Uma
      // falha no meio deixa o mesmo conjunto elegível; IDs determinísticos fazem
      // a reexecução convergir em vez de duplicar eventos.
      await pool.query(
        `SELECT app.calendar_sync_mark_success($1::uuid)`,
        [connection.id],
      );
    }
  }

  return { usersProcessed, eventsSynced, failures };
}
