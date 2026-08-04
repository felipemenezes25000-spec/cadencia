import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';
import { readRelations, rlsViolations } from '../../src/invariants/inv01-rls';

/**
 * §5.3 — a agenda comeca pelo catalogo de procedimentos. Cor, duracao e valor sao
 * do procedimento, nao do agendamento: e o que permite a grade desenhar o bloco
 * antes de existir qualquer regra de faturamento.
 */
const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

describe('sched.procedure', () => {
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

  it('o schema sched entra na varredura dos invariantes', async () => {
    // Nao basta o schema existir: ele tem que estar na lista que os invariantes
    // 1, 2, 7, 8 e 10 varrem. Schema fora da lista e schema sem regra nenhuma.
    expect(TENANT_SCHEMAS).toContain('sched');

    const relacoes = await readRelations(admin);
    expect(relacoes.map((r) => `${r.schema}.${r.relation}`)).toContain('sched.procedure');
    expect(rlsViolations(relacoes)).toEqual([]);
  });

  it('cor e duracao dirigem a renderizacao do slot', async () => {
    const linha = await comoAtor(api, ANA, async (c) => {
      await c.query(
        `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
         VALUES ($1, gen_random_uuid(), 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
        [F.TENANT_A],
      );
      const { rows } = await c.query(
        `SELECT cor, duracao_min, valor_centavos::int AS valor FROM sched.procedure
          WHERE tenant_id = $1 AND code = 'CONS'`,
        [F.TENANT_A],
      );
      return rows[0];
    });
    expect(linha).toEqual({ cor: '#2f5fd0', duracao_min: 30, valor: 25000 });
  });

  it('recusa cor fora do formato hexadecimal', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
           VALUES ($1, gen_random_uuid(), 'X', 'X', 'azul', 30)`,
          [F.TENANT_A],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
    expect(erro.message).toMatch(/violates check constraint/);
  });

  it('recusa duracao nao positiva — slot de zero minuto quebra a grade', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
           VALUES ($1, gen_random_uuid(), 'Y', 'Y', '#000000', 0)`,
          [F.TENANT_A],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
    expect(erro.message).toMatch(/violates check constraint/);
  });
});
