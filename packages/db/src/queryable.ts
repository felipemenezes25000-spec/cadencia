import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Contrato mínimo de execução de SQL. `Pool`, `PoolClient` e `Client` do `pg` o
 * satisfazem — e é por isso que todo check roda tanto no pool quanto dentro de uma
 * transação revertida, sem duas versões do mesmo código.
 *
 * Fonte ÚNICA: o harness de conformidade, o runner dos invariantes e o verificador
 * de restauração (Task 48) usam este tipo. Duas declarações com o mesmo nome e
 * assinaturas diferentes seriam compatibilidade estrutural acidental que ninguém
 * mantém sincronizada.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}
