import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { persistVariationSnapshot, readVariationSnapshot } from './persist-variation';
import { factorsAddUp, type VariationFactors, type VariationSnapshot } from './variation-types';
import { semearVariacao, type SementeVariacao } from './test-support';

describe('persistVariationSnapshot e readVariationSnapshot', () => {
  let s: SementeVariacao;
  let businessPool: Pool;
  let jobPool: Pool;

  const factors: VariationFactors = {
    volume_cents: -500_00,
    mix_procedimento_cents: 100_00,
    mix_convenio_cents: -200_00,
    ticket_cents: -200_00,
    faltas_cents: -50_00,
    glosas_cents: 0,
    total_a_cents: 125_000,
    total_b_cents: 40_000,
    delta_total_cents: -85_000,
  };

  beforeAll(async () => {
    s = await semearVariacao();
    businessPool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
      options: '-c role=app_rw',
    });
    jobPool = new Pool({
      connectionString: process.env['DATABASE_URL_JOBS'],
      max: 2,
    });
  });

  afterAll(async () => {
    await businessPool.end();
    await jobPool.end();
  });

  it('persiste snapshot via jobs e le via app_rpt', async () => {
    const snapshot: VariationSnapshot = {
      tenantId: s.tenantId, clinicId: s.clinicId,
      periodA: { start: '2026-06-01', end: '2026-06-30' },
      periodB: { start: '2026-07-01', end: '2026-07-31' },
      computedAt: new Date().toISOString(),
      factors,
    };

    // Persistir como jobs (BYPASSRLS)
    const jc = await jobPool.connect();
    try {
      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot,
      );
      await jc.query('COMMIT');
    } finally {
      jc.release();
    }

    // Ler como app_rw via withTenantTx (RLS)
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, businessPool);

    expect(result).not.toBeNull();
    expect(result!.factors.delta_total_cents).toBe(-85_000);
    expect(factorsAddUp(result!.factors)).toBe(true);
  });

  it('upsert substitui snapshot existente', async () => {
    const snapshot1: VariationSnapshot = {
      tenantId: s.tenantId, clinicId: s.clinicId,
      periodA: { start: '2026-05-01', end: '2026-05-31' },
      periodB: { start: '2026-06-01', end: '2026-06-30' },
      computedAt: new Date().toISOString(),
      factors: { ...factors, delta_total_cents: -85_000, ticket_cents: -200_00 },
    };
    const snapshot2: VariationSnapshot = {
      ...snapshot1,
      factors: {
        ...factors,
        volume_cents: -100_00,
        ticket_cents: 65_00,
        delta_total_cents: -85_000,
      },
    };

    const jc = await jobPool.connect();
    try {
      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot1,
      );
      await jc.query('COMMIT');

      await jc.query('BEGIN');
      await persistVariationSnapshot(
        { query: (sql, params) => jc.query(sql, params === undefined ? undefined : [...params]) },
        snapshot2,
      );
      await jc.query('COMMIT');
    } finally {
      jc.release();
    }

    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2026-05-01', end: '2026-05-31' },
        { start: '2026-06-01', end: '2026-06-30' },
      );
    }, businessPool);

    expect(result).not.toBeNull();
    expect(result!.factors.volume_cents).toBe(-100_00);
  });

  it('retorna null para snapshot inexistente', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-persist-3',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return readVariationSnapshot(tx, s.tenantId, s.clinicId,
        { start: '2020-01-01', end: '2020-01-31' },
        { start: '2020-02-01', end: '2020-02-29' },
      );
    }, businessPool);

    expect(result).toBeNull();
  });
});
