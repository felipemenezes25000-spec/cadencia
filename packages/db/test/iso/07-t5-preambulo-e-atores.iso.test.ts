import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, Pool } from 'pg';
import { erroPg, openClient, semContexto } from './harness';
import { withTenantTx, type Actor } from '../../src/tx';
import * as F from './fixtures';

describe('T5 e T5b — preambulo ausente e os tres tipos de Actor', () => {
  let api: Client;
  /** withTenantTx recebe o pool do container desta execucao pelo terceiro argumento. */
  let isoPool: Pool;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    isoPool = new Pool({ connectionString: inject('isoApiUrl'), max: 2 });
  });

  afterAll(async () => {
    await api.end();
    await isoPool.end();
  });

  it('T5 — sem preambulo, a leitura devolve zero linhas em vez de erro', async () => {
    await semContexto(api, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient',
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('T5 — sem preambulo, nenhuma das tabelas multi-tenant devolve linha', async () => {
    await semContexto(api, async (c) => {
      for (const rel of [
        'app.tenant',
        'app.clinic',
        'app.membership',
        'app.professional',
        'clin.patient',
        'clin.patient_identifier',
        'clin.record_share',
      ]) {
        const { rows } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${rel}`,
        );
        expect(rows[0]!.n, `${rel} entregou linha sem contexto de tenant`).toBe(0);
      }
    });
  });

  it('T5 — sem preambulo, a ESCRITA falha alto, com 42501 e mensagem explicita', async () => {
    const erro = await erroPg(() =>
      semContexto(api, (c) =>
        c.query(
          `INSERT INTO clin.patient (id, full_name) VALUES ($1, 'Paciente orfao')`,
          ['01930000-0000-7000-8000-00000000f701'],
        ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('contexto de tenant ausente');
  });

  it('T5 — a variavel de contexto e LOCAL: nao sobrevive ao fim da transacao', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, TRUE)`, [F.TENANT_A]);
    const dentro = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(dentro.rows[0]!.t).toBe(F.TENANT_A);
    await api.query('COMMIT');

    const depois = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(
      depois.rows[0]!.t,
      'o contexto vazou para fora da transacao: com PgBouncer isso entrega o tenant anterior a requisicao seguinte',
    ).toBeNull();
  });

  it('T5b — ator user le o proprio tenant pelo caminho real do withTenantTx', async () => {
    const ator: Actor = {
      kind: 'user',
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    const n = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM clin.patient',
        );
        return rows[0]!.n;
      },
      isoPool,
    );
    expect(n).toBe(2);
  });

  it('T5b — ator system nao tem user_id e mesmo assim NAO explode com 22P02', async () => {
    const ator: Actor = {
      kind: 'system',
      tenantId: F.TENANT_A,
      reason: 'selo diario da auditoria',
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{
          u: string | null;
          membro: boolean;
          pacientes: number;
        }>(
          `SELECT app.current_user_id() AS u,
                  app.is_member() AS membro,
                  (SELECT count(*)::int FROM clin.patient) AS pacientes`,
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado.u).toBeNull();
    expect(resultado.membro).toBe(true);
    expect(resultado.pacientes).toBe(2);
  });

  it('T5b — ator anon do agendamento online nao explode e nao le prontuario', async () => {
    const ator: Actor = {
      kind: 'anon',
      tenantId: F.TENANT_A,
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{
          u: string | null;
          membro: boolean;
          pacientes: number;
        }>(
          `SELECT app.current_user_id() AS u,
                  app.is_member() AS membro,
                  (SELECT count(*)::int FROM clin.patient) AS pacientes`,
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado.u).toBeNull();
    expect(resultado.membro).toBe(false);
    expect(resultado.pacientes).toBe(0);
  });

  it('T5b — nenhum tipo de Actor produz o erro 22P02 de uuid vazio', async () => {
    const atores: Actor[] = [
      {
        kind: 'user',
        tenantId: F.TENANT_A,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_A_SP,
        requestId: F.REQUEST_ID,
      },
      {
        kind: 'system',
        tenantId: F.TENANT_A,
        reason: 'despachante de outbox',
        requestId: F.REQUEST_ID,
      },
      { kind: 'anon', tenantId: F.TENANT_A, requestId: F.REQUEST_ID },
    ];

    for (const ator of atores) {
      let codigo: string | undefined;
      try {
        await withTenantTx(
          ator,
          async (tx) => {
            await tx.query(
              `SELECT app.current_tenant_id(), app.current_user_id(),
                      app.current_professional_id(), app.is_member(),
                      app.clinical_scope_all()`,
            );
          },
          isoPool,
        );
      } catch (e) {
        codigo = (e as { code?: string }).code;
      }
      expect(
        codigo,
        `ator '${ator.kind}' quebrou: uuid vazio nao esta protegido por nullif`,
      ).toBeUndefined();
    }
  });

  it('T5b — a regra do nullif e mecanica: os dois leitores de GUC do banco a contem', async () => {
    const admin = await openClient(inject('isoAdminUrl'));
    try {
      const { rows } = await admin.query<{ proname: string; prosrc: string }>(
        `SELECT p.proname, p.prosrc
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app'
            AND p.proname IN ('current_tenant_id','current_user_id')
          ORDER BY p.proname`,
      );
      expect(rows.map((r) => r.proname)).toEqual(['current_tenant_id', 'current_user_id']);
      for (const fn of rows) {
        // Sem nullif, ''::uuid levanta 22P02 e quebra worker, webhook e agendamento
        // online em 100% das execucoes. A assercao existe para que remover o nullif
        // numa migration futura reprove aqui, e nao em producao.
        expect(fn.prosrc, `app.${fn.proname} perdeu o nullif`).toContain('nullif');
      }
    } finally {
      await admin.end();
    }
  });
});
