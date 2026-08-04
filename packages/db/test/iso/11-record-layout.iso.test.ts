import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const T = {
  secao: '0198f2a0-0003-7000-8000-000000000010',
};

// 'sinais_vitais' ja e a secao viva do seed e ux_record_section_viva e por
// (tenant_id, code) — a secao daqui precisa de code proprio.
const CRIA_SECAO = `
  INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
  VALUES ($1, $2, 'odontograma', 'Odontograma', 9)`;

const CRIA_LAYOUT = `
  INSERT INTO clin.record_layout_item
    (tenant_id, id, professional_id, section_id, ordinal, visible)
  VALUES ($1, gen_random_uuid(), $2, $3, $4, $5)`;

describe('layout do prontuario por profissional', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('cada profissional tem ordem e visibilidade proprias na mesma secao', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
      await c.query(CRIA_LAYOUT, [F.TENANT_A, F.PROF_A_ANA, T.secao, 1, false]);
      await c.query(CRIA_LAYOUT, [F.TENANT_A, F.PROF_A_BRUNO, T.secao, 3, true]);
      const { rows } = await c.query<{
        professional_id: string;
        ordinal: number;
        visible: boolean;
      }>(
        `SELECT professional_id, ordinal, visible FROM clin.record_layout_item
          WHERE tenant_id = $1 AND section_id = $2 ORDER BY professional_id`,
        [F.TENANT_A, T.secao],
      );
      return rows;
    });
    expect(linhas).toEqual([
      { professional_id: F.PROF_A_ANA, ordinal: 1, visible: false },
      { professional_id: F.PROF_A_BRUNO, ordinal: 3, visible: true },
    ]);
  });

  it('recusa dois layouts do mesmo profissional para a mesma secao', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, async (c) => {
        await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
        await c.query(CRIA_LAYOUT, [F.TENANT_A, F.PROF_A_ANA, T.secao, 1, false]);
        await c.query(CRIA_LAYOUT, [F.TENANT_A, F.PROF_A_ANA, T.secao, 2, true]);
      }),
    );
    expect(erro.code).toBe('23505');
    expect(erro.message).toMatch(/ux_layout_item/);
  });
});
