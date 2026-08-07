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

describe('matviews rpt.mv_financeiro, rpt.mv_pacientes e rpt.mv_satisfacao (migration 0103)', () => {
  it('rpt.mv_financeiro existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT a.attname AS column_name FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'entry_id', 'kind', 'category', 'method', 'amount_cents',
      'paid_at', 'due_date', 'status', 'professional_id', 'clinic_id',
      'bank_account_id', 'cost_center_id', 'tenant_id',
    ]);
  });

  it('rpt.mv_financeiro pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_financeiro' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_pacientes existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT a.attname AS column_name FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'patient_id', 'age_bracket', 'gender', 'source',
      'first_visit', 'last_visit', 'visit_count', 'tenant_id',
    ]);
  });

  it('rpt.mv_pacientes pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_pacientes' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });

  it('rpt.mv_satisfacao existe como matview com colunas corretas', async () => {
    const { rows: kind } = await catalogPool().query<{ relkind: string }>(`
      SELECT c.relkind::text FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao'`);
    expect(kind).toHaveLength(1);
    expect(kind[0]!.relkind).toBe('m');

    const { rows } = await catalogPool().query<{ column_name: string }>(`
      SELECT a.attname AS column_name FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`);
    const colunas = rows.map((r) => r.column_name);
    expect(colunas).toEqual([
      'nps_response_id', 'score', 'category', 'professional_id',
      'clinic_id', 'responded_at', 'tenant_id',
    ]);
  });

  it('rpt.mv_satisfacao pertence a rpt_owner e tem indice unico', async () => {
    const { rows: owner } = await catalogPool().query<{ owner: string }>(`
      SELECT r.rolname AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao'`);
    expect(owner[0]!.owner).toBe('rpt_owner');

    const { rows: idx } = await catalogPool().query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rpt' AND c.relname = 'mv_satisfacao' AND ix.indisunique`);
    expect(Number(idx[0]!.cnt)).toBeGreaterThanOrEqual(1);
  });
});

describe('views security_barrier em app_rpt (migration 0108)', () => {
  const VIEWS = [
    'atendimentos',
    'financeiro',
    'agenda',
    'pacientes',
    'satisfacao',
  ] as const;

  for (const view of VIEWS) {
    it(`app_rpt.${view} existe como view com security_barrier = true`, async () => {
      const { rows } = await catalogPool().query<{
        relkind: string;
        owner: string;
        has_barrier: boolean;
      }>(`
        SELECT
          c.relkind::text,
          r.rolname AS owner,
          EXISTS (
            SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
             WHERE lower(o.opt) = 'security_barrier=true'
          ) AS has_barrier
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'app_rpt' AND c.relname = $1`, [view]);
      expect(rows, `view app_rpt.${view} nao encontrada`).toHaveLength(1);
      expect(rows[0]!.relkind).toBe('v');
      expect(rows[0]!.owner).toBe('rpt_owner');
      expect(rows[0]!.has_barrier).toBe(true);
    });

    it(`app_rw tem SELECT em app_rpt.${view}`, async () => {
      const { rows } = await catalogPool().query<{ has_select: boolean }>(`
        SELECT has_table_privilege('app_rw', 'app_rpt.${view}', 'SELECT') AS has_select`);
      expect(rows[0]!.has_select).toBe(true);
    });
  }

  it('nenhuma view em app_rpt e security_invoker (executa com privilegios do dono)', async () => {
    const { rows } = await catalogPool().query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_rpt' AND c.relkind = 'v'
        AND EXISTS (
          SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
           WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on')
        )`);
    expect(rows, 'views em app_rpt nao devem ser security_invoker').toHaveLength(0);
  });
});

describe('funcoes de refresh rpt.refresh_mv_* (migration 0107)', () => {
  const MATVIEWS = [
    'mv_atendimentos',
    'mv_financeiro',
    'mv_agenda',
    'mv_pacientes',
    'mv_satisfacao',
  ] as const;

  for (const mv of MATVIEWS) {
    const fnName = `rpt.refresh_${mv}`;

    it(`${fnName} existe como SECURITY DEFINER pertencente a rpt_owner`, async () => {
      const { rows } = await catalogPool().query<{
        proname: string;
        owner: string;
        prosecdef: boolean;
      }>(`
        SELECT p.proname, r.rolname AS owner, p.prosecdef
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_roles r ON r.oid = p.proowner
         WHERE n.nspname = 'rpt' AND p.proname = $1`, [`refresh_${mv}`]);
      expect(rows, `funcao ${fnName} nao encontrada`).toHaveLength(1);
      expect(rows[0]!.owner).toBe('rpt_owner');
      expect(rows[0]!.prosecdef).toBe(true);
    });

    it(`jobs tem EXECUTE em ${fnName}`, async () => {
      const { rows } = await catalogPool().query<{ has_exec: boolean }>(`
        SELECT has_function_privilege('jobs', '${fnName}()', 'EXECUTE') AS has_exec`);
      expect(rows[0]!.has_exec).toBe(true);
    });
  }
});
