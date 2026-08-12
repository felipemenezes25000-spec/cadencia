import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { auditPool, closePools } from './pool';
import { withTenantTx, type Actor } from './tx';

const TENANT_A = '01930000-0000-7000-8000-00000000aa01';
const TENANT_B = '01930000-0000-7000-8000-00000000bb01';
const USER_A = '01930000-0000-7000-8000-00000000aa02';
const CLINIC_A = '01930000-0000-7000-8000-00000000aa03';
const REQUEST = '01930000-0000-7000-8000-00000000aa04';

const atorA: Actor = {
  kind: 'user',
  tenantId: TENANT_A,
  userId: USER_A,
  clinicId: CLINIC_A,
  requestId: REQUEST,
};
const atorB: Actor = {
  kind: 'user',
  tenantId: TENANT_B,
  userId: USER_A,
  clinicId: CLINIC_A,
  requestId: REQUEST,
};
const atorSistema: Actor = {
  kind: 'system',
  tenantId: TENANT_A,
  reason: 'outbox-dispatch',
  requestId: REQUEST,
};
const atorAnonimo: Actor = { kind: 'anon', tenantId: TENANT_A, requestId: REQUEST };

let admin: Pool;
/** max = 1 força todas as transações do teste a reusar a MESMA conexão física. */
let umaConexao: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });

  // Tabela-sonda do teste: existe só para observar commit e rollback sem depender
  // de nenhuma tabela de domínio.
  await admin.query(`
    CREATE TABLE IF NOT EXISTS public.tx_probe (
      id uuid PRIMARY KEY, canal text NOT NULL, nota text NOT NULL)`);
  await admin.query('GRANT USAGE ON SCHEMA public TO app_rw');
  await admin.query('GRANT SELECT, INSERT, DELETE ON public.tx_probe TO app_rw');
  // O canal B grava por um pool próprio e NÃO executa SET LOCAL ROLE app_rw (ele roda
  // fora da transação de negócio). Como `api` é NOINHERIT, sem estes dois GRANTs o
  // INSERT do canal B falharia com 42501 e o teste mediria permissão, não a
  // sobrevivência ao ROLLBACK. Em produção o canal B grava por função SECURITY DEFINER
  // do schema audit; aqui a sonda faz o papel dela.
  await admin.query('GRANT USAGE ON SCHEMA public TO api');
  await admin.query('GRANT SELECT, INSERT, DELETE ON public.tx_probe TO api');
  await admin.query('TRUNCATE public.tx_probe');

  umaConexao = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: 'cadencia-tx-test',
  });
});

afterAll(async () => {
  await admin.query('DROP TABLE IF EXISTS public.tx_probe');
  await admin.query('REVOKE USAGE ON SCHEMA public FROM api');
  await admin.end();
  await umaConexao.end();
  await closePools();
});

describe('escopo transacional do preambulo', () => {
  it('o tenant nao sobrevive ao COMMIT: a conexao devolvida ao pool vem limpa', async () => {
    const dentro = await withTenantTx(
      atorA,
      async (tx) => {
        const r = await tx.query<{ tid: string | null }>('SELECT app.current_tenant_id() AS tid');
        return r.rows[0]?.tid ?? null;
      },
      umaConexao,
    );
    expect(dentro).toBe(TENANT_A);

    // Mesma conexão física (max = 1), agora fora de transação.
    // Após o COMMIT o valor de transação some, mas o *placeholder* de GUC continua
    // existindo na sessão: o Postgres devolve '' (string vazia), não NULL. As duas
    // formas significam "sem tenant"; qualquer uuid aqui é vazamento entre clínicas.
    const depois = await umaConexao.query<{ vazou: string | null }>(
      `SELECT current_setting('app.tenant_id', true) AS vazou`,
    );
    expect(depois.rows[0]?.vazou ?? '').toBe('');
  });

  it('duas transacoes seguidas na mesma conexao enxergam tenants diferentes', async () => {
    const a = await withTenantTx(
      atorA,
      async (tx) => (await tx.query<{ t: string }>('SELECT app.current_tenant_id() AS t')).rows[0]?.t,
      umaConexao,
    );
    const b = await withTenantTx(
      atorB,
      async (tx) => (await tx.query<{ t: string }>('SELECT app.current_tenant_id() AS t')).rows[0]?.t,
      umaConexao,
    );
    expect(a).toBe(TENANT_A);
    expect(b).toBe(TENANT_B);
  });

  it('prova do contrario: com is_local = FALSE o tenant vaza para a transacao seguinte', async () => {
    const client = await umaConexao.connect();
    try {
      await client.query('BEGIN');
      // Exatamente o que `SET app.tenant_id = ...` faz. Nunca escreva isto fora deste teste.
      await client.query(`SELECT set_config('app.tenant_id', $1, FALSE)`, [TENANT_A]);
      await client.query('COMMIT');

      const vazado = await client.query<{ t: string | null }>(
        `SELECT current_setting('app.tenant_id', true) AS t`,
      );
      expect(vazado.rows[0]?.t).toBe(TENANT_A); // o próximo tenant leria isto
    } finally {
      await client.query(`SELECT set_config('app.tenant_id', '', FALSE)`);
      client.release();
    }
  });
});

describe('os tres tipos de Actor', () => {
  it('ator de usuario grava tenant, usuario, clinica, tipo e request_id', async () => {
    const ctx = await withTenantTx(
      atorA,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; c: string; k: string; r: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.clinic_id', true)  AS c,
                    current_setting('app.actor_kind', true) AS k,
                    current_setting('app.request_id', true) AS r`,
          )
        ).rows[0],
      umaConexao,
    );
    // request_id é o único fio que liga o evento de auditoria à requisição HTTP.
    // Sem esta asserção, errar o nome do GUC só aparece no bloco de audit.
    expect(ctx).toEqual({ t: TENANT_A, u: USER_A, c: CLINIC_A, k: 'user', r: REQUEST });
  });

  it('ator de sistema entra sem usuario e sem clinica, e nada explode', async () => {
    const ctx = await withTenantTx(
      atorSistema,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; bruto: string; k: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.user_id', true) AS bruto,
                    current_setting('app.actor_kind', true) AS k`,
          )
        ).rows[0],
      umaConexao,
    );
    expect(ctx?.t).toBe(TENANT_A);
    expect(ctx?.u).toBeNull(); // nullif transformou '' em NULL
    expect(ctx?.bruto).toBe(''); // o GUC é sempre texto, nunca NULL
    expect(ctx?.k).toBe('system');
  });

  it('ator anonimo do agendamento online entra so com tenant', async () => {
    const ctx = await withTenantTx(
      atorAnonimo,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; k: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.actor_kind', true) AS k`,
          )
        ).rows[0],
      umaConexao,
    );
    expect(ctx?.t).toBe(TENANT_A);
    expect(ctx?.u).toBeNull();
    expect(ctx?.k).toBe('anon');
  });
});

describe('erro, rollback e devolucao da conexao', () => {
  it('faz ROLLBACK quando o callback lanca, e a excecao original chega ao chamador', async () => {
    const id = '01930000-0000-7000-8000-00000000cc01';

    await expect(
      withTenantTx(
        atorA,
        async (tx) => {
          await tx.query('INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)', [
            id,
            'negocio',
            'nao pode sobreviver',
          ]);
          throw new Error('falha de dominio');
        },
        umaConexao,
      ),
    ).rejects.toThrowError('falha de dominio');

    const r = await admin.query('SELECT id FROM public.tx_probe WHERE id = $1', [id]);
    expect(r.rows).toHaveLength(0);
  });

  it('devolve a conexao ao pool mesmo depois do erro: a transacao seguinte funciona', async () => {
    await expect(
      withTenantTx(atorA, async () => {
        throw new Error('boom');
      }, umaConexao),
    ).rejects.toThrowError('boom');

    // Com max = 1, se a conexão não tivesse sido devolvida esta chamada travaria.
    const vivo = await withTenantTx(
      atorA,
      async (tx) => (await tx.query<{ n: number }>('SELECT 1 AS n')).rows[0]?.n,
      umaConexao,
    );
    expect(vivo).toBe(1);
    expect(umaConexao.idleCount).toBe(1);
  });

  it('recusa ator com tenantId vazio antes de tocar no banco', async () => {
    await expect(
      withTenantTx(
        { kind: 'anon', tenantId: '', requestId: REQUEST },
        async () => 'nunca',
        umaConexao,
      ),
    ).rejects.toThrowError(/tenantId vazio/);
  });
});

describe('canal B da auditoria fora da transacao de negocio', () => {
  it('o evento gravado pelo pool de auditoria sobrevive ao ROLLBACK do negocio', async () => {
    const idNegocio = '01930000-0000-7000-8000-00000000dd01';
    const idAuditoria = '01930000-0000-7000-8000-00000000dd02';

    await expect(
      withTenantTx(
        atorA,
        async (tx) => {
          await tx.query('INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)', [
            idNegocio,
            'negocio',
            'acesso negado',
          ]);
          // Canal B: pool próprio, conexão própria, transação própria.
          await auditPool().query(
            'INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)',
            [idAuditoria, 'auditoria', 'ACCESS_DENIED'],
          );
          throw new Error('acesso negado');
        },
        umaConexao,
      ),
    ).rejects.toThrowError('acesso negado');

    const r = await admin.query<{ id: string; canal: string }>(
      'SELECT id, canal FROM public.tx_probe WHERE id = ANY($1::uuid[]) ORDER BY canal',
      [[idNegocio, idAuditoria]],
    );
    // O que o auditor procura é justamente o evento da transação que falhou.
    expect(r.rows).toEqual([{ id: idAuditoria, canal: 'auditoria' }]);
  });
});
