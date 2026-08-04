import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('ref.observation_code', () => {
  afterAll(async () => { await closePools(); });

  it('traz PA_SIS e PA_DIA separados — pressao arterial e campo composto', async () => {
    const { rows } = await appPool().query<{ code: string; unit: string; value_kind: string }>(
      `SELECT code, unit, value_kind FROM ref.observation_code
        WHERE code IN ('PA_SIS','PA_DIA') ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'PA_DIA', unit: 'mmHg', value_kind: 'numeric' },
      { code: 'PA_SIS', unit: 'mmHg', value_kind: 'numeric' },
    ]);
  });

  it('carrega faixa plausivel para peso — 700 kg tem de ser recusavel', async () => {
    const { rows } = await appPool().query<{ min_plausible: string; max_plausible: string }>(
      `SELECT min_plausible, max_plausible FROM ref.observation_code WHERE code = 'PESO'`,
    );
    expect(Number(rows[0]?.min_plausible)).toBe(0.2);
    expect(Number(rows[0]?.max_plausible)).toBe(400);
  });

  it('e declarada global-reference — a suite test:iso nao exige tenant_id nela', async () => {
    const { rows } = await appPool().query<{ c: string }>(
      `SELECT obj_description('ref.observation_code'::regclass, 'pg_class') AS c`,
    );
    expect(rows[0]?.c).toBe('global-reference');
  });
});
