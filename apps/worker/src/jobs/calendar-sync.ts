import { businessPool } from '@cadencia/db';

export interface CalendarSyncResult {
  readonly usersProcessed: number;
  readonly eventsSynced: number;
}

export async function syncCalendars(): Promise<CalendarSyncResult> {
  const pool = businessPool();
  const { rows } = await pool.query<{ id: string; user_id: string; provider: string }>(
    `SELECT id, user_id, provider
       FROM app.calendar_sync
      WHERE enabled = true
        AND (last_sync_at IS NULL OR last_sync_at < clock_timestamp() - interval '14 minutes')`,
  );

  for (const row of rows) {
    await pool.query(
      `UPDATE app.calendar_sync SET last_sync_at = clock_timestamp() WHERE id = $1`,
      [row.id],
    );
  }

  return { usersProcessed: rows.length, eventsSynced: 0 };
}
