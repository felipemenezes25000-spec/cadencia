import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Contrato minimo de execucao de SQL. `Pool`, `PoolClient` e `Client` do `pg` o
 * satisfazem — e e por isso que todo check roda tanto no pool quanto dentro de uma
 * transacao revertida, sem duas versoes do mesmo codigo.
 *
 * Fonte UNICA: o harness de conformidade, o runner dos invariantes e o verificador
 * de restauracao (Task 48) usam este tipo. Duas declaracoes com o mesmo nome e
 * assinaturas diferentes seriam compatibilidade estrutural acidental que ninguem
 * mantem sincronizada.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}
