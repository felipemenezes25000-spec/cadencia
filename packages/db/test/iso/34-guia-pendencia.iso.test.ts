import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.guia_pendencia — pendencia de reprojecao apos envio de lote', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  const actorDiego: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_B,
    userId: F.USER_B_DIEGO,
    clinicId: F.CLINIC_B_RIO_BRANCO,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela existe no schema tiss com as colunas esperadas', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_pendencia'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'guia_id', 'encounter_version_id',
      'tipo', 'resolved_at', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('RLS esta habilitada e forcada', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'tiss.guia_pendencia'::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('FK composta para tiss.encounter_guia_consulta(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_pendencia'::regclass
          AND con.confrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta para clin.encounter_version(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_pendencia'::regclass
          AND con.confrelid = 'clin.encounter_version'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('CHECK tipo IN (reprojecao_pos_envio) rejeita valor invalido', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `INSERT INTO tiss.guia_pendencia
             (tenant_id, id, guia_id, encounter_version_id, tipo)
           VALUES ($1, gen_random_uuid(), $2, $3, 'tipo_invalido')`,
          [F.TENANT_A, F.GUIA_CONSULTA_A, F.VERSION_A_JOANA_ORIGINAL],
        );
      });
    });
    expect(erro.code).toBe('23514');
  });

  it('tenant A nao enxerga pendencia do tenant B', async () => {
    const { rows } = await new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
      comoAtor(rw, actorAna, async (c) => {
        const r = await c.query<{ id: string }>(
          `SELECT id FROM tiss.guia_pendencia WHERE id = $1`,
          [F.GUIA_PENDENCIA_B],
        );
        resolve(r);
      });
    });
    expect(rows).toHaveLength(0);
  });

  it('tenant B nao enxerga pendencia do tenant A', async () => {
    const { rows } = await new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
      comoAtor(rw, actorDiego, async (c) => {
        const r = await c.query<{ id: string }>(
          `SELECT id FROM tiss.guia_pendencia WHERE id = $1`,
          [F.GUIA_PENDENCIA_A],
        );
        resolve(r);
      });
    });
    expect(rows).toHaveLength(0);
  });

  it('app_rw pode fazer UPDATE somente em resolved_at', async () => {
    const { rows } = await admin.query<{ column_name: string; privilege_type: string }>(
      `SELECT column_name, privilege_type
         FROM information_schema.column_privileges
        WHERE table_schema = 'tiss' AND table_name = 'guia_pendencia'
          AND grantee = 'app_rw' AND privilege_type = 'UPDATE'`,
    );
    const updatableColumns = rows.map((r) => r.column_name);
    expect(updatableColumns).toEqual(['resolved_at']);
  });
});
