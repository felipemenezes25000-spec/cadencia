import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, Pool } from 'pg';
import { comContextoForjado, erroPg, openClient } from './harness';
import { withTenantTx, type Actor } from '../../src/tx';
import * as F from './fixtures';

describe('T6 — contexto forjado', () => {
  let api: Client;
  let isoPool: Pool;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    isoPool = new Pool({ connectionString: inject('isoApiUrl'), max: 2 });
  });

  afterAll(async () => {
    await api.end();
    await isoPool.end();
  });

  it('a rota que aceitasse tenantId do cliente nao entregaria uma linha sequer', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B, // veio do cliente
        userId: F.USER_A_ANA, // veio da sessao, e de outro tenant
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM clin.patient',
        );
        expect(rows[0]!.n).toBe(0);
      },
    );
  });

  it('e o motivo e app.is_member(), nao a coincidencia de nao haver linha', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ membro: boolean; tenant: string }>(
          'SELECT app.is_member() AS membro, app.current_tenant_id()::text AS tenant',
        );
        expect(rows[0]).toEqual({ membro: false, tenant: F.TENANT_B });
      },
    );
  });

  it('o contexto forjado tambem nao consegue ESCREVER no tenant alheio', async () => {
    const erro = await erroPg(() =>
      comContextoForjado(
        api,
        {
          tenantId: F.TENANT_B,
          userId: F.USER_A_ANA,
          clinicId: F.CLINIC_B_RIO_BRANCO,
        },
        (c) =>
          c.query(
            `INSERT INTO clin.patient (id, full_name)
             VALUES ($1, 'Paciente plantado por contexto forjado')`,
            ['01930000-0000-7000-8000-00000000f801'],
          ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('row-level security policy');
  });

  it('o contexto forjado nao consegue ABRIR atendimento no tenant alheio', async () => {
    // Esta sonda e mais afiada que a de clin.patient de proposito. O INSERT usa o
    // paciente, o profissional e a clinica DO PROPRIO tenant B, entao toda FK
    // composta fecha e a integridade referencial nao tem o que reclamar. A
    // RESTRICTIVE `clinical_scope` tambem nao ajuda aqui: ela e FOR SELECT.
    // Sobra uma unica linha de defesa — o `AND app.is_member()` do WITH CHECK de
    // `tenant_isolation`. Tire aquele predicado da 0030 e este teste fica
    // vermelho sozinho; todo o resto da suite continuaria verde, porque na
    // LEITURA a `clinical_scope` absorve a perda e esconde o buraco de ESCRITA.
    const erro = await erroPg(() =>
      comContextoForjado(
        api,
        {
          tenantId: F.TENANT_B,
          userId: F.USER_A_ANA,
          clinicId: F.CLINIC_B_RIO_BRANCO,
        },
        (c) =>
          c.query(
            `INSERT INTO clin.encounter
               (tenant_id, id, patient_id, professional_id, clinic_id,
                occurred_at, occurred_date)
             VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
                     app.local_date(clock_timestamp(), 'America/Rio_Branco'))`,
            [
              F.TENANT_B,
              '01930000-0000-7000-8000-00000000f802',
              F.PATIENT_B_MARCOS,
              F.PROF_B_DIEGO,
              F.CLINIC_B_RIO_BRANCO,
            ],
          ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('row-level security policy');
  });

  it('o contexto forjado nao enxerga nem o vinculo do usuario legitimo do outro tenant', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM app.membership',
        );
        expect(rows[0]!.n).toBe(0);
      },
    );
  });

  it('trocar apenas o clinicId dentro do proprio tenant tambem nao amplia o que se le', async () => {
    const ator: Actor = {
      kind: 'user',
      tenantId: F.TENANT_A,
      userId: F.USER_A_BRUNO,
      // Bruno so tem vinculo em Sao Paulo; o cliente mandou Manaus.
      clinicId: F.CLINIC_A_MANAUS,
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{ manaus: boolean; sp: boolean }>(
          `SELECT app.has_role_in($1, ARRAY['profissional']) AS manaus,
                  app.has_role_in($2, ARRAY['profissional']) AS sp`,
          [F.CLINIC_A_MANAUS, F.CLINIC_A_SP],
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado).toEqual({ manaus: false, sp: true });
  });
});
