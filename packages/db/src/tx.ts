import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { businessPool } from './pool';

/**
 * §3.2 — Ator da transacao.
 *
 * Papel e profissional não estao aqui de proposito: são DERIVADOS do vinculo
 * dentro do banco (app.membership / app.professional). Papel escalar vindo do
 * cliente da acesso total ou nenhum ao medico que e admin em uma unidade e
 * assistente em outra — que e a norma no Brasil.
 */
export type Actor =
  | { kind: 'user'; tenantId: string; userId: string; clinicId: string; requestId: string }
  | { kind: 'system'; tenantId: string; reason: string; requestId: string } // worker/outbox
  | { kind: 'anon'; tenantId: string; requestId: string }; // agendamento online

/** Superficie de consulta entregue ao callback. não expoe BEGIN/COMMIT/ROLLBACK. */
export interface TxClient {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * O terceiro argumento TRUE e o item mais importante do sistema inteiro.
 *
 * TRUE  = escopo de TRANSACAO: some no COMMIT/ROLLBACK.
 * FALSE = escopo de SESSAO: sobrevive. Com PgBouncer em transaction mode a
 *         conexao e reciclada entre tenants, e o tenant anterior vaza para a
 *         requisicao seguinte. A RLS filtra certo, pelo tenant errado.
 *
 * Todo GUC e gravado como texto e nunca como NULL: ausencia vira string vazia,
 * e o banco le com nullif(..., ''). O ator de sistema e o anonimo não tem
 * user_id, e ''::uuid levantaria 22P02 abortando a transacao inteira.
 */
const PREAMBLE = `SELECT
  set_config('app.tenant_id',  $1, TRUE),
  set_config('app.user_id',    $2, TRUE),
  set_config('app.clinic_id',  $3, TRUE),
  set_config('app.actor_kind', $4, TRUE),
  set_config('app.request_id', $5, TRUE)`;

type PreambleParams = readonly [string, string, string, string, string];

export function preambleParams(actor: Actor): PreambleParams {
  switch (actor.kind) {
    case 'user':
      return [actor.tenantId, actor.userId, actor.clinicId, 'user', actor.requestId];
    case 'system':
      return [actor.tenantId, '', '', 'system', actor.requestId];
    case 'anon':
      return [actor.tenantId, '', '', 'anon', actor.requestId];
  }
}

function wrap(client: PoolClient): TxClient {
  return {
    query: <R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<R>> =>
      client.query<R>(sql, params === undefined ? undefined : [...params]),
  };
}

/**
 * O UNICO lugar do sistema que abre transacao de negocio.
 *
 * O papel `jobs` (unico com BYPASSRLS) não usa esta funcao: o SET LOCAL ROLE
 * abaixo o faria perder o BYPASSRLS e voltar a enxergar zero linhas.
 *
 * O erro do PostgreSQL sobe CRU, com o SQLSTATE intacto. Traduzir aqui exigiria
 * importar packages/kernel, e irmão não importa irmão (§2.2): a tradução por
 * domainErrorFromSqlState acontece na borda HTTP, em L3.
 */
export async function withTenantTx<T>(
  actor: Actor,
  fn: (tx: TxClient) => Promise<T>,
  pool: Pool = businessPool(),
): Promise<T> {
  if (actor.tenantId === '') {
    throw new Error('withTenantTx: tenantId vazio — o preambulo nunca roda sem tenant');
  }

  const client = await pool.connect();
  let conexaoQuebrada = false;

  try {
    await client.query('BEGIN');
    // `api` foi criado NOINHERIT: sem esta linha toda query retorna 42501.
    // E uma trava a mais — codigo que não passa por aqui não le nada.
    await client.query('SET LOCAL ROLE app_rw');
    await client.query(PREAMBLE, [...preambleParams(actor)]);

    const resultado = await fn(wrap(client));

    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK falhou: a conexao esta em estado desconhecido e sera descartada
      // no finally. O erro original e o que interessa ao chamador.
      conexaoQuebrada = true;
    }
    throw err;
  } finally {
    // release(Error) descarta a conexao em vez de devolve-la ao pool. Conexao com
    // estado indefinido nunca volta para a fila: ela carregaria GUC de outro tenant.
    client.release(
      conexaoQuebrada ? new Error('conexao descartada: ROLLBACK falhou') : undefined,
    );
  }
}
