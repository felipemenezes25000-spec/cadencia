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

const DIEGO: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_B,
  userId: F.USER_B_DIEGO,
  clinicId: F.CLINIC_B_RIO_BRANCO,
  requestId: F.REQUEST_ID,
};

const T = {
  atendimento: '0198f2a0-0003-7000-8000-000000000001',
};

const CRIA_ATENDIMENTO = `
  INSERT INTO clin.encounter
    (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
  VALUES ($1, $2, $3, $4, $5, $6::timestamptz,
          app.local_date($6::timestamptz, (SELECT timezone FROM app.clinic WHERE id = $5)))`;

describe('clin.encounter', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('grava occurred_date pelo fuso da CLINICA, nao pelo do servidor', async () => {
    const linha = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_ATENDIMENTO, [
        F.TENANT_A,
        T.atendimento,
        F.PATIENT_A_JOANA,
        F.PROF_A_ANA,
        F.CLINIC_A_SP,
        '2026-08-04T02:30:00Z',
      ]);
      const { rows } = await c.query<{ d: string; s: string }>(
        `SELECT occurred_date::text AS d, status::text AS s
           FROM clin.encounter WHERE id = $1`,
        [T.atendimento],
      );
      return rows[0];
    });
    // 02:30Z = 23:30 do dia 03 em Sao Paulo. Se sair 2026-08-04, o fuso vazou.
    expect(linha).toEqual({ d: '2026-08-03', s: 'rascunho' });
  });

  it('app_rw NAO consegue trocar o paciente do atendimento — isso e clin.transfer_encounter', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, async (c) => {
        await c.query(CRIA_ATENDIMENTO, [
          F.TENANT_A,
          T.atendimento,
          F.PATIENT_A_JOANA,
          F.PROF_A_ANA,
          F.CLINIC_A_SP,
          '2026-08-04T02:30:00Z',
        ]);
        await c.query(`UPDATE clin.encounter SET patient_id = $2 WHERE id = $1`, [
          T.atendimento,
          F.PATIENT_A_RECEM_NASCIDO,
        ]);
      }),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toMatch(/permission denied for table encounter/);
  });

  it('referencia cruzada de tenant e violacao de integridade, nao leitura vazia', async () => {
    // Diego e do tenant B e escreve NO tenant B: a policy deixa passar. O que
    // barra e a FK composta — o paciente do tenant A nao existe no par (B, id).
    const erro = await erroPg(() =>
      comoAtor(api, DIEGO, (c) =>
        c.query(CRIA_ATENDIMENTO, [
          F.TENANT_B,
          '0198f2a0-0003-7000-8000-000000000002',
          F.PATIENT_A_JOANA,
          F.PROF_B_DIEGO,
          F.CLINIC_B_RIO_BRANCO,
          '2026-08-04T02:30:00Z',
        ]),
      ),
    );
    expect(erro.code).toBe('23503');
    expect(erro.message).toMatch(/violates foreign key constraint/);
  });

  it('tem policy RESTRICTIVE — a tabela tem patient_id', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'clin' AND c.relname = 'encounter' AND NOT p.polpermissive`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
