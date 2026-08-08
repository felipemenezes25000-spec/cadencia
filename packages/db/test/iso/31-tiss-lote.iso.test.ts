import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import * as F from './fixtures';
import { comoAtor, erroPg, openClient } from './harness';

describe('tiss.lote e tiss.lote_guia — isolamento e estrutura', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
    await admin.end();
  });

  // ── Estrutura ──────────────────────────────────────────────────────────────

  it('tiss.lote tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote'::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('tiss.lote_guia tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote_guia'::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('tiss.lote_number_counter tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote_number_counter'::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('numero_lote e varchar(12) — tamanho maximo do campo no XML TISS', async () => {
    const { rows } = await admin.query<{ data_type: string; character_maximum_length: number }>(
      `SELECT data_type, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'lote'
          AND column_name = 'numero_lote'`,
    );
    expect(rows[0]?.data_type).toBe('character varying');
    expect(rows[0]?.character_maximum_length).toBe(12);
  });

  it('xml_storage_key e xml_hash_md5 vivem ou morrem juntos (CHECK)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.lote'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%xml_storage_key%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.def).toContain('num_nonnulls');
  });

  it('sent_at so existe se lote foi enviado ou retornado (CHECK)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.lote'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%sent_at%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('guia so pertence a um lote — indice unico em (tenant_id, guia_id)', async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'tiss' AND tablename = 'lote_guia'
          AND indexdef LIKE '%UNIQUE%'
          AND indexdef LIKE '%guia_id%'
          AND indexdef NOT LIKE '%lote_id%sequencial_item%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // ── Isolamento T1: tenant A nao ve lote do tenant B ─────────────────────

  it('tenant A nao enxerga lote do tenant B', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      const { rows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.lote WHERE id = $1`, [F.LOTE_B],
      );
      expect(rows).toEqual([]);
    });
  });

  it('tenant A nao enxerga lote_guia do tenant B', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      const { rows } = await c.query<{ lote_id: string }>(
        `SELECT lote_id FROM tiss.lote_guia WHERE lote_id = $1`, [F.LOTE_B],
      );
      expect(rows).toEqual([]);
    });
  });

  // ── next_lote_number: auto-provisionamento ─────────────────────────────

  it('next_lote_number auto-provisiona e incrementa', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      // O seed ja provisionou com next_value=2, entao a proxima chamada
      // retorna 2 (incrementa para 3).
      const { rows: r1 } = await c.query<{ next_lote_number: string }>(
        `SELECT tiss.next_lote_number($1, $2) AS next_lote_number`,
        [F.TENANT_A, F.OPERADORA_A],
      );
      const n1 = Number(r1[0]?.next_lote_number);
      expect(n1).toBeGreaterThanOrEqual(2);

      const { rows: r2 } = await c.query<{ next_lote_number: string }>(
        `SELECT tiss.next_lote_number($1, $2) AS next_lote_number`,
        [F.TENANT_A, F.OPERADORA_A],
      );
      const n2 = Number(r2[0]?.next_lote_number);
      expect(n2).toBe(n1 + 1);
    });
  });
});
