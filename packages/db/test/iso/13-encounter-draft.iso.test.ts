import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const T = {
  atendimento: '0198f2a0-0004-7000-8000-000000000001',
};

const CRIA_ATENDIMENTO = `
  INSERT INTO clin.encounter
    (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
  VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-04T13:00:00Z',
          app.local_date(TIMESTAMPTZ '2026-08-04T13:00:00Z',
                         (SELECT timezone FROM app.clinic WHERE id = $5)))`;

const CRIA_RASCUNHO = `
  INSERT INTO clin.encounter_draft (tenant_id, encounter_id, payload, updated_by)
  VALUES ($1, $2, '{"queixa":"cefaleia"}'::jsonb, app.current_user_id())
  RETURNING rev`;

/**
 * A gravacao do rascunho e SEMPRE condicionada a revisao que o cliente leu.
 * Nao ha `SET rev = $n`: o banco e quem incrementa, e o WHERE e quem decide se a
 * gravacao vale — e assim que o conflito aparece como zero linhas afetadas.
 */
const GRAVA_RASCUNHO = `
  UPDATE clin.encounter_draft
     SET payload = $3::jsonb, rev = rev + 1,
         updated_at = clock_timestamp(), updated_by = app.current_user_id()
   WHERE tenant_id = $1 AND encounter_id = $2 AND rev = $4
  RETURNING rev`;

describe('clin.encounter_draft', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('nasce na revisao 1 e sobe a cada gravacao aceita', async () => {
    const revisoes = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_ATENDIMENTO, [
        F.TENANT_A,
        T.atendimento,
        F.PATIENT_A_JOANA,
        F.PROF_A_ANA,
        F.CLINIC_A_SP,
      ]);
      const nascimento = await c.query<{ rev: number }>(CRIA_RASCUNHO, [
        F.TENANT_A,
        T.atendimento,
      ]);
      const gravacao = await c.query<{ rev: number }>(GRAVA_RASCUNHO, [
        F.TENANT_A,
        T.atendimento,
        '{"queixa":"cefaleia ha 3 dias"}',
        1,
      ]);
      return { nasce: nascimento.rows[0]?.rev, sobe: gravacao.rows[0]?.rev };
    });
    expect(revisoes).toEqual({ nasce: 1, sobe: 2 });
  });

  it('gravacao com revisao velha nao afeta nenhuma linha — e o conflito que a tela mostra', async () => {
    const linhasAfetadas = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_ATENDIMENTO, [
        F.TENANT_A,
        T.atendimento,
        F.PATIENT_A_JOANA,
        F.PROF_A_ANA,
        F.CLINIC_A_SP,
      ]);
      await c.query(CRIA_RASCUNHO, [F.TENANT_A, T.atendimento]);

      // O desktop grava primeiro e leva o rascunho para a revisao 2.
      await c.query(GRAVA_RASCUNHO, [
        F.TENANT_A,
        T.atendimento,
        '{"queixa":"digitado no desktop"}',
        1,
      ]);

      // O celular ainda acha que esta na revisao 1: a gravacao dele nao pode
      // apagar o que o desktop acabou de escrever.
      const conflito = await c.query(GRAVA_RASCUNHO, [
        F.TENANT_A,
        T.atendimento,
        '{"queixa":"ditado no celular"}',
        1,
      ]);
      return conflito.rowCount;
    });
    expect(linhasAfetadas).toBe(0);
  });

  // §3.5: o rascunho e a unica superficie MUTAVEL do registro clinico. As demais
  // tabelas de clin. com UPDATE (identificador, secao, layout) sao cadastro e
  // configuracao, nao registro — por isso a comparacao aqui e com o atendimento.
  it('rascunho tem UPDATE e DELETE para app_rw; o atendimento ao lado nao tem nenhum dos dois', async () => {
    const { rows } = await api.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'clin' AND table_name = 'encounter_draft'
          AND grantee = 'app_rw'
        ORDER BY privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual([
      'DELETE',
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);

    // O atendimento, que e o registro em si, continua sem UPDATE nenhum: o que e
    // mutavel e o rascunho, nunca o agregado clinico ao lado dele.
    const { rows: doAtendimento } = await api.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'clin' AND table_name = 'encounter'
          AND grantee = 'app_rw'
        ORDER BY privilege_type`,
    );
    expect(doAtendimento.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });
});
