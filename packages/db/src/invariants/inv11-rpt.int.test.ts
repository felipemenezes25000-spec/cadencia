// packages/db/src/invariants/inv11-rpt.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool } from './catalog';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 11 — fundacoes do esquema de relatorios (migration 0101)', () => {
  it('schema app_rpt existe e pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ nspname: string; owner: string }>(`
      SELECT n.nspname, r.rolname AS owner
        FROM pg_namespace n
        JOIN pg_roles r ON r.oid = n.nspowner
       WHERE n.nspname = 'app_rpt'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt_owner tem BYPASSRLS', async () => {
    const { rows } = await catalogPool().query<{ rolbypassrls: boolean }>(`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'rpt_owner'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rolbypassrls).toBe(true);
  });

  it('app_owner e membro de rpt_owner (necessario para SET ROLE nas migrations)', async () => {
    const { rows } = await catalogPool().query<{ is_member: boolean }>(`
      SELECT pg_has_role('app_owner', 'rpt_owner', 'MEMBER') AS is_member`);
    expect(rows[0]!.is_member).toBe(true);
  });

  it('rpt.refresh_log existe com colunas corretas', async () => {
    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'refresh_log'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'id', 'matview_name', 'started_at', 'finished_at', 'row_count', 'success', 'error_message',
    ]);
  });

  it('rpt_owner tem USAGE nos schemas-fonte (clin, fin, sched, msg)', async () => {
    for (const schema of ['clin', 'fin', 'sched', 'msg']) {
      const { rows } = await catalogPool().query<{ has_usage: boolean }>(`
        SELECT has_schema_privilege('rpt_owner', $1, 'USAGE') AS has_usage`, [schema]);
      expect(rows[0]!.has_usage, `rpt_owner sem USAGE em ${schema}`).toBe(true);
    }
  });

  it('rpt_owner tem SELECT nas tabelas-fonte das matviews', async () => {
    const tabelas = [
      'clin.encounter', 'clin.encounter_version', 'clin.diagnosis',
      'clin.procedure', 'clin.patient',
      'fin.entry', 'fin.category', 'fin.payment_method',
      'fin.bank_account', 'fin.cost_center',
      'sched.appointment',
      'msg.nps_response',
      'app.membership', 'app.professional', 'app.clinic',
    ];
    for (const tabela of tabelas) {
      const { rows } = await catalogPool().query<{ has_select: boolean }>(`
        SELECT has_table_privilege('rpt_owner', $1, 'SELECT') AS has_select`, [tabela]);
      expect(rows[0]!.has_select, `rpt_owner sem SELECT em ${tabela}`).toBe(true);
    }
  });

  it('jobs tem USAGE em rpt e SELECT/INSERT/UPDATE em rpt.refresh_log', async () => {
    const { rows: usage } = await catalogPool().query<{ has_usage: boolean }>(`
      SELECT has_schema_privilege('jobs', 'rpt', 'USAGE') AS has_usage`);
    expect(usage[0]!.has_usage).toBe(true);

    for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
      const { rows } = await catalogPool().query<{ has_priv: boolean }>(`
        SELECT has_table_privilege('jobs', 'rpt.refresh_log', $1) AS has_priv`, [priv]);
      expect(rows[0]!.has_priv, `jobs sem ${priv} em rpt.refresh_log`).toBe(true);
    }
  });

  it('app_rw tem USAGE em app_rpt e SELECT em rpt.refresh_log', async () => {
    const { rows: usage } = await catalogPool().query<{ has_usage: boolean }>(`
      SELECT has_schema_privilege('app_rw', 'app_rpt', 'USAGE') AS has_usage`);
    expect(usage[0]!.has_usage).toBe(true);

    const { rows: sel } = await catalogPool().query<{ has_select: boolean }>(`
      SELECT has_table_privilege('app_rw', 'rpt.refresh_log', 'SELECT') AS has_select`);
    expect(sel[0]!.has_select).toBe(true);
  });
});

describe('matviews rpt.mv_atendimentos e rpt.mv_agenda (migration 0102)', () => {
  it('rpt.mv_atendimentos existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_atendimentos'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'encounter_id', 'patient_id', 'professional_id', 'clinic_id',
      'occurred_date', 'duration_minutes', 'procedure_codes', 'diagnosis_codes',
      'version_count', 'status', 'tenant_id',
    ]);
  });

  it('rpt.mv_atendimentos pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos'`);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt.mv_atendimentos tem indice unico para REFRESH CONCURRENTLY', async () => {
    const { rows } = await catalogPool().query<{ indexname: string }>(`
      SELECT i.relname AS indexname FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_atendimentos' AND ix.indisunique`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_agenda existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'rpt' AND table_name = 'mv_agenda'
       ORDER BY ordinal_position`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'appointment_date', 'professional_id', 'clinic_id',
      'total_slots', 'booked', 'confirmed', 'attended',
      'no_shows', 'cancelled', 'occupancy_pct', 'tenant_id',
    ]);
  });

  it('rpt.mv_agenda pertence a rpt_owner', async () => {
    const { rows } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda'`);
    expect(rows[0]!.owner).toBe('rpt_owner');
  });

  it('rpt.mv_agenda tem indice unico para REFRESH CONCURRENTLY', async () => {
    const { rows } = await catalogPool().query<{ indexname: string }>(`
      SELECT i.relname AS indexname FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_agenda' AND ix.indisunique`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
