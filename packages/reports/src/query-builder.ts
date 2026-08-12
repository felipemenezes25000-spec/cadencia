// packages/reports/src/query-builder.ts
import { ValidationError } from '@cadencia/kernel';
import type { BuiltQuery, ReportQuery, ReportFilter, FilterOp } from './types';

/** Views permitidas — único ponto de whitelist. */
const ALLOWED_VIEWS = new Set(['atendimentos', 'financeiro', 'pacientes', 'mensagens']);

/** Regex para validar nomes de colunas: só letras, números e underscore. */
const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;

function assertValidColumn(name: string): void {
  if (!COLUMN_RE.test(name)) {
    throw new ValidationError(
      'report.nome_de_coluna_invalido',
      'nome de coluna invalido: so letras minusculas, numeros e underscore',
      { column: name },
    );
  }
}

function buildFilterClause(
  filter: ReportFilter,
  paramIdx: number,
): { clause: string; params: unknown[]; nextIdx: number } {
  assertValidColumn(filter.column);

  const col = filter.column;
  const opMap: Record<FilterOp, () => { clause: string; params: unknown[]; nextIdx: number }> = {
    eq: () => ({
      clause: `${col} = $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    neq: () => ({
      clause: `${col} <> $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    gt: () => ({
      clause: `${col} > $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    gte: () => ({
      clause: `${col} >= $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    lt: () => ({
      clause: `${col} < $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    lte: () => ({
      clause: `${col} <= $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
    in: () => {
      const values = filter.value as readonly unknown[];
      const placeholders = values.map((_, i) => `$${paramIdx + i}`);
      return {
        clause: `${col} IN (${placeholders.join(', ')})`,
        params: [...values],
        nextIdx: paramIdx + values.length,
      };
    },
    between: () => {
      const [low, high] = filter.value as [unknown, unknown];
      return {
        clause: `${col} >= $${paramIdx} AND ${col} <= $${paramIdx + 1}`,
        params: [low, high],
        nextIdx: paramIdx + 2,
      };
    },
    like: () => ({
      clause: `${col} ILIKE $${paramIdx}`,
      params: [filter.value],
      nextIdx: paramIdx + 1,
    }),
  };

  return opMap[filter.op]();
}

/**
 * Monta SQL parametrizado a partir de uma ReportQuery.
 *
 * NUNCA interpola valores — tudo via $N. Nomes de colunas e views são validados
 * contra whitelist e regex. O SQL resultante roda sobre app_rpt views, que já
 * aplicam security_barrier com predicado de tenant e papel.
 */
export function buildQuery(query: ReportQuery): BuiltQuery {
  if (!ALLOWED_VIEWS.has(query.view)) {
    throw new ValidationError(
      'report.view_invalida',
      'view invalida: nao pertence ao conjunto permitido',
      { view: query.view },
    );
  }

  // Validar colunas visíveis
  for (const col of query.columns.visible) {
    assertValidColumn(col);
  }

  // Validar colunas de sort
  for (const s of query.sort) {
    assertValidColumn(s.column);
  }

  const params: unknown[] = [query.limit, query.offset];
  let paramIdx = 3;

  // SELECT
  const selectParts: string[] = [];
  if (query.columns.groupBy !== undefined) {
    assertValidColumn(query.columns.groupBy);
    selectParts.push(query.columns.groupBy);
    if (query.columns.aggregate !== undefined) {
      assertValidColumn(query.columns.aggregate.column);
      const fn = query.columns.aggregate.fn;
      selectParts.push(`${fn}(${query.columns.aggregate.column}) AS ${query.columns.aggregate.fn}_${query.columns.aggregate.column}`);
    }
  } else {
    selectParts.push(...query.columns.visible);
  }

  // WHERE
  const whereClauses: string[] = [];
  for (const filter of query.filters) {
    const result = buildFilterClause(filter, paramIdx);
    whereClauses.push(result.clause);
    params.push(...result.params);
    paramIdx = result.nextIdx;
  }

  // ORDER BY
  const orderParts: string[] = [];
  for (const s of query.sort) {
    const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
    orderParts.push(`${s.column} ${dir}`);
  }

  // Montar SQL
  let sql = `SELECT ${selectParts.join(', ')} FROM app_rpt.${query.view}`;
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  if (query.columns.groupBy !== undefined) {
    sql += ` GROUP BY ${query.columns.groupBy}`;
  }
  if (orderParts.length > 0) {
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  }
  sql += ` LIMIT $1 OFFSET $2`;

  return { sql, params };
}
