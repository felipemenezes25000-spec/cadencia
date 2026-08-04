import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA_ADMIN: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const BRUNO_PROFISSIONAL: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_BRUNO,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const CARLA_RECEPCAO: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_CARLA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

async function identificadoresVisiveis(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ patient_id: string }>(
    'SELECT patient_id FROM clin.patient_identifier ORDER BY patient_id',
  );
  return rows.map((r) => r.patient_id);
}

describe('policy RESTRICTIVE de escopo clinico', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('admin_clinico enxerga os identificadores de toda a clinica', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      const vistos = await identificadoresVisiveis(c);
      expect(vistos).toHaveLength(2);
      expect(vistos).toContain(F.PATIENT_A_JOANA);
      expect(vistos).toContain(F.PATIENT_A_RECEM_NASCIDO);
    });
  });

  it('a recepcao enxerga os identificadores, porque cobrar exige o CPF', async () => {
    await comoAtor(api, CARLA_RECEPCAO, async (c) => {
      expect(await identificadoresVisiveis(c)).toHaveLength(2);
    });
  });

  it('profissional sem escopo total so enxerga o paciente compartilhado com ele', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      expect(await identificadoresVisiveis(c)).toEqual([F.PATIENT_A_JOANA]);
    });
  });

  it('revogar o compartilhamento tira o acesso no mesmo instante', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      await c.query(
        'UPDATE clin.record_share SET revoked_at = clock_timestamp() WHERE id = $1',
        [F.SHARE_A_JOANA_PARA_BRUNO],
      );
      await c.query(`SELECT set_config('app.user_id', $1, TRUE)`, [F.USER_A_BRUNO]);
      expect(await identificadoresVisiveis(c)).toEqual([]);
    });
  });

  it('a policy RESTRICTIVE nao abre acesso: o profissional continua sem ver outro tenant', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient_identifier WHERE tenant_id = $1',
        [F.TENANT_B],
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('profissional so enxerga compartilhamento em que ele e parte', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM clin.record_share',
      );
      expect(rows.map((r) => r.id)).toEqual([F.SHARE_A_JOANA_PARA_BRUNO]);
    });
  });

  it('toda tabela clin.* com patient_id ou version_id tem policy RESTRICTIVE', async () => {
    const admin = await openClient(inject('isoAdminUrl'));
    try {
      const { rows } = await admin.query<{ rel: string; restritivas: number }>(
        `SELECT c.relname AS rel,
                (SELECT count(*)::int FROM pg_policy p
                  WHERE p.polrelid = c.oid AND NOT p.polpermissive) AS restritivas
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'clin' AND c.relkind IN ('r','p')
            AND EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND NOT a.attisdropped
                           AND a.attname IN ('patient_id','version_id'))
          ORDER BY 1`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const linha of rows) {
        expect(linha.restritivas, `clin.${linha.rel} sem policy RESTRICTIVE`)
          .toBeGreaterThanOrEqual(1);
      }
    } finally {
      await admin.end();
    }
  });
});
