// packages/reports/test/refresh.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { refreshMatview, getLatestRefresh, MATVIEW_NAMES } from '../src/refresh';

afterAll(async () => {
  await closePools();
});

describe('packages/reports — refresh de matviews via app_rpt', () => {
  it('refreshMatview executa sem erro para cada matview (dados vazios)', async () => {
    const pool = jobsPool();
    for (const mv of MATVIEW_NAMES) {
      await expect(refreshMatview(pool, mv)).resolves.not.toThrow();
    }
  });

  it('apos refresh, rpt.refresh_log contem registros com success = true', async () => {
    const pool = jobsPool();
    const logs = await getLatestRefresh(pool);
    expect(logs.length).toBeGreaterThanOrEqual(MATVIEW_NAMES.length);
    for (const log of logs) {
      expect(log.success).toBe(true);
      expect(log.finishedAt).not.toBeNull();
      expect(log.rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('refreshMatview rejeita nome de matview invalido', async () => {
    const pool = jobsPool();
    await expect(refreshMatview(pool, 'mv_inexistente' as never)).rejects.toThrow(
      'matview desconhecida',
    );
  });

  it('getLatestRefresh retorna o refresh mais recente por matview', async () => {
    const pool = jobsPool();
    // Executa um segundo refresh para mv_atendimentos
    await refreshMatview(pool, 'mv_atendimentos');
    const logs = await getLatestRefresh(pool);
    const atend = logs.find((l) => l.matviewName === 'mv_atendimentos');
    expect(atend).toBeDefined();
    expect(atend!.success).toBe(true);
  });
});
