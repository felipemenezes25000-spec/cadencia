import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('app.local_date', () => {
  afterAll(async () => { await closePools(); });

  it('deriva a data no fuso da UNIDADE, nao no do servidor', async () => {
    // 2026-08-04T02:30:00Z = 03/08 as 23:30 em Sao Paulo e 03/08 as 22:30 em Rio Branco.
    const { rows } = await appPool().query<{ sp: string; rb: string; utc: string }>(
      `SELECT app.local_date($1::timestamptz, 'America/Sao_Paulo')::text AS sp,
              app.local_date($1::timestamptz, 'America/Rio_Branco')::text AS rb,
              app.local_date($1::timestamptz, 'UTC')::text AS utc`,
      ['2026-08-04T02:30:00Z'],
    );
    expect(rows[0]).toEqual({ sp: '2026-08-03', rb: '2026-08-03', utc: '2026-08-04' });
  });

  it('e IMMUTABLE — pode ser usada em coluna gerada e em indice', async () => {
    const { rows } = await appPool().query<{ provolatile: string }>(
      `SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname = 'local_date'`,
    );
    expect(rows[0]?.provolatile).toBe('i');
  });

  it('recusa fuso desconhecido em vez de devolver a data do servidor', async () => {
    await expect(
      appPool().query(`SELECT app.local_date(now(), 'America/Atlantis')`),
    ).rejects.toThrow(/time zone|fuso/i);
  });
});
