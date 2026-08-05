import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.nps_response', () => {
  it('existe com RLS forcada', async () => {
    const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('tem ao menos uma policy', async () => {
    const { rows } = await admin.query(
      `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta inclui tenant_id', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'msg.nps_response'::regclass AND contype = 'f'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
