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

describe('msg.compute_send_at — fuso da clinica', () => {
  it('lembrete 24h antes: consulta 8h SP sai 8h dia anterior SP, nao 5h UTC', async () => {
    // Consulta as 8h em America/Sao_Paulo = 11:00 UTC
    // Offset -1440 min (24h antes)
    // Esperado: 8h dia anterior SP = 11:00 UTC dia anterior
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-06T11:00:00Z');
  });

  it('lembrete 2h antes: consulta 8h SP sai 6h SP (9h UTC)', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -120)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-07T09:00:00Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-08T11:00:00Z');
  });

  it('NPS 7 dias depois', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 10080)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-14T11:00:00Z');
  });

  it('confirma que 24h antes NAO e simplesmente subtrair 1440 min do UTC', async () => {
    // Demonstra o ERRO que teríamos se subtraíssemos diretamente do UTC.
    // DST 2026 em America/New_York começa em 2026-03-08 02:00 (spring forward).
    // Consulta 2026-03-08 09:00 EDT (UTC-4) = 13:00 UTC
    // 24h antes local = 2026-03-07 09:00 EST (UTC-5) = 14:00 UTC
    // Se fosse subtração pura: 13:00 - 24h = 13:00 dia anterior (ERRADO)
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-03-08T13:00:00Z'::timestamptz, 'America/New_York', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    // 2026-03-07 09:00 EST = 14:00 UTC, NÃO 13:00 UTC
    expect(rows[0]!.send_at).toBe('2026-03-07T14:00:00Z');
  });
});
