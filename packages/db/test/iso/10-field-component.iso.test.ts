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
  secao: '0198f2a0-0001-7000-8000-000000000010',
  campoPa: '0198f2a0-0002-7000-8000-000000000010',
};

// 'sinais_vitais' ja e uma secao viva do tenant A no seed, e ux_record_section_viva
// e por (tenant_id, code) — a secao daqui precisa de code proprio.
const CRIA_SECAO = `
  INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
  VALUES ($1, $2, 'exame_fisico', 'Exame fisico', 4)`;

const CRIA_CAMPO_PA = `
  INSERT INTO clin.record_field
    (tenant_id, id, section_id, code, label, kind, is_reportable, ordinal)
  VALUES ($1, $2, $3, 'pa', 'Pressao arterial', 'composto', true, 1)`;

const CRIA_COMPONENTES_PA = `
  INSERT INTO clin.record_field_component
    (tenant_id, id, field_id, ordinal, observation_code, label, unit)
  VALUES ($1, gen_random_uuid(), $2, 1, 'PA_SIS', 'Sistolica', 'mmHg'),
         ($1, gen_random_uuid(), $2, 2, 'PA_DIA', 'Diastolica', 'mmHg')`;

describe('campo composto', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('PA produz DUAS observacoes, com ordinal proprio', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
      await c.query(CRIA_CAMPO_PA, [F.TENANT_A, T.campoPa, T.secao]);
      await c.query(CRIA_COMPONENTES_PA, [F.TENANT_A, T.campoPa]);
      const { rows } = await c.query<{ ordinal: number; observation_code: string }>(
        `SELECT ordinal, observation_code FROM clin.record_field_component
          WHERE tenant_id = $1 AND field_id = $2 ORDER BY ordinal`,
        [F.TENANT_A, T.campoPa],
      );
      return rows;
    });
    expect(linhas).toEqual([
      { ordinal: 1, observation_code: 'PA_SIS' },
      { ordinal: 2, observation_code: 'PA_DIA' },
    ]);
  });

  it('recusa dois componentes no mesmo ordinal do mesmo campo', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, async (c) => {
        await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
        await c.query(CRIA_CAMPO_PA, [F.TENANT_A, T.campoPa, T.secao]);
        await c.query(CRIA_COMPONENTES_PA, [F.TENANT_A, T.campoPa]);
        await c.query(
          `INSERT INTO clin.record_field_component
             (tenant_id, id, field_id, ordinal, observation_code, label, unit)
           VALUES ($1, gen_random_uuid(), $2, 1, 'FC', 'Duplicata', 'bpm')`,
          [F.TENANT_A, T.campoPa],
        );
      }),
    );
    expect(erro.code).toBe('23505');
    expect(erro.message).toMatch(/record_field_component_tenant_id_field_id_ordinal_key/);
  });

  it('recusa codigo de observacao que nao esta no catalogo global', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, async (c) => {
        await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
        await c.query(CRIA_CAMPO_PA, [F.TENANT_A, T.campoPa, T.secao]);
        await c.query(
          `INSERT INTO clin.record_field_component
             (tenant_id, id, field_id, ordinal, observation_code, label, unit)
           VALUES ($1, gen_random_uuid(), $2, 3, 'PA_MEDIA', 'Media', 'mmHg')`,
          [F.TENANT_A, T.campoPa],
        );
      }),
    );
    expect(erro.code).toBe('23503');
    expect(erro.message).toMatch(/observation_code_fkey|violates foreign key/);
  });
});
