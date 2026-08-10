### Task 44: Tipos e query builder do Explorar — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/types.ts`
- Criar `packages/reports/src/query-builder.ts`
- Criar `packages/reports/src/query-builder.test.ts`
- Modificar `packages/reports/src/index.ts`
- Modificar `packages/reports/package.json`

**Por que**: o Explorar e um query builder generico que monta SQL sobre as views `app_rpt.*`. Antes de qualquer rota ou tela, o dominio precisa dos tipos de filtro, coluna e ordenacao, e da funcao `buildQuery` que transforma esses objetos em SQL parametrizado seguro. O `reports` esta em L2 e depende apenas de `@cadencia/kernel` (L0).

- [ ] Adicionar dependencia de `@cadencia/kernel` ao `package.json` do reports:

```jsonc
// packages/reports/package.json
{
  "name": "@cadencia/reports",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*"
  }
}
```

- [ ] Criar o arquivo de tipos:

```ts
// packages/reports/src/types.ts

/**
 * Tipos do Explorar — query builder sobre app_rpt views.
 *
 * Cada view em app_rpt expoe colunas desnormalizadas (tenant_id ja filtrado
 * pela security_barrier). O Explorar monta SELECT/WHERE/ORDER dinamicamente
 * a partir de filtros combinaveis: periodo, profissional, clinica, procedimento,
 * convenio, status, CID, faixa etaria, genero, fonte.
 */

/** Nomes das views expostas em app_rpt. Cada view mapeia um eixo de analise. */
export type ReportView =
  | 'atendimentos'
  | 'financeiro'
  | 'pacientes'
  | 'mensagens';

/** Operadores de comparacao suportados pelo query builder. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'between'
  | 'like';

/** Um filtro individual do Explorar. */
export interface ReportFilter {
  readonly column: string;
  readonly op: FilterOp;
  readonly value: unknown;
}

/** Direcao de ordenacao. */
export type SortDir = 'asc' | 'desc';

/** Definicao de ordenacao. */
export interface ReportSort {
  readonly column: string;
  readonly dir: SortDir;
}

/** Tipo de grafico para visualizacao. */
export type ChartKind = 'bar' | 'line' | 'pie' | 'table';

/** Colunas selecionadas para exibicao. */
export interface ReportColumns {
  readonly visible: readonly string[];
  readonly groupBy?: string;
  readonly aggregate?: {
    readonly column: string;
    readonly fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  };
}

/** Configuracao completa de uma consulta do Explorar. */
export interface ReportQuery {
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly limit: number;
  readonly offset: number;
}

/** Resultado tipado de buildQuery — SQL parametrizado pronto para execucao. */
export interface BuiltQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Formato de exportacao. */
export type ExportFormat = 'csv' | 'xlsx';

/** Definicao de uma visao salva (filtros pre-configurados). */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly chartKind: ChartKind;
}

/** Definicao de visao customizada do usuario. */
export interface CustomViewInput {
  readonly name: string;
  readonly view: ReportView;
  readonly filters: readonly ReportFilter[];
  readonly columns: ReportColumns;
  readonly sort: readonly ReportSort[];
  readonly chartKind: ChartKind;
}
```

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/query-builder.test.ts
import { describe, expect, it } from 'vitest';
import { buildQuery } from './query-builder';
import type { ReportQuery } from './types';

describe('buildQuery', () => {
  it('gera SELECT com colunas visiveis sobre a view correta', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name', 'patient_name', 'occurred_date'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('FROM app_rpt.atendimentos');
    expect(result.sql).toContain('professional_name');
    expect(result.sql).toContain('patient_name');
    expect(result.sql).toContain('occurred_date');
    expect(result.sql).toContain('LIMIT $1');
    expect(result.sql).toContain('OFFSET $2');
    expect(result.params).toEqual([50, 0]);
  });

  it('adiciona clausula WHERE para filtro eq', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'professional_id', op: 'eq', value: 'abc-123' }],
      columns: { visible: ['professional_name'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toMatch(/professional_id\s*=\s*\$3/);
    expect(result.params).toEqual([50, 0, 'abc-123']);
  });

  it('adiciona clausula WHERE para filtro between (periodo)', () => {
    const q: ReportQuery = {
      view: 'financeiro',
      filters: [{ column: 'occurred_date', op: 'between', value: ['2026-07-01', '2026-07-31'] }],
      columns: { visible: ['amount_cents'] },
      sort: [],
      limit: 100,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/occurred_date\s*>=\s*\$3/);
    expect(result.sql).toMatch(/occurred_date\s*<=\s*\$4/);
    expect(result.params).toEqual([100, 0, '2026-07-01', '2026-07-31']);
  });

  it('adiciona clausula WHERE para filtro in', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'status', op: 'in', value: ['confirmado', 'realizado'] }],
      columns: { visible: ['status'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/status\s+IN\s*\(\$3,\s*\$4\)/);
    expect(result.params).toEqual([50, 0, 'confirmado', 'realizado']);
  });

  it('adiciona clausula WHERE para filtro like', () => {
    const q: ReportQuery = {
      view: 'pacientes',
      filters: [{ column: 'patient_name', op: 'like', value: '%Silva%' }],
      columns: { visible: ['patient_name'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/patient_name\s+ILIKE\s+\$3/);
    expect(result.params).toEqual([50, 0, '%Silva%']);
  });

  it('adiciona ORDER BY com direcao', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['occurred_date', 'professional_name'] },
      sort: [{ column: 'occurred_date', dir: 'desc' }],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/ORDER BY\s+occurred_date\s+DESC/);
  });

  it('adiciona GROUP BY e funcao de agregacao quando presentes', () => {
    const q: ReportQuery = {
      view: 'financeiro',
      filters: [],
      columns: {
        visible: ['category_name'],
        groupBy: 'category_name',
        aggregate: { column: 'amount_cents', fn: 'sum' },
      },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toContain('GROUP BY category_name');
    expect(result.sql).toContain('sum(amount_cents)');
  });

  it('combina multiplos filtros com AND', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [
        { column: 'professional_id', op: 'eq', value: 'prof-1' },
        { column: 'status', op: 'eq', value: 'realizado' },
      ],
      columns: { visible: ['professional_name', 'status'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    const result = buildQuery(q);
    expect(result.sql).toMatch(/professional_id\s*=\s*\$3/);
    expect(result.sql).toMatch(/status\s*=\s*\$4/);
    expect(result.sql).toContain('AND');
    expect(result.params).toEqual([50, 0, 'prof-1', 'realizado']);
  });

  it('rejeita nome de view fora do conjunto permitido', () => {
    const q: ReportQuery = {
      view: 'nao_existe' as any,
      filters: [],
      columns: { visible: ['id'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('view invalida');
  });

  it('rejeita nome de coluna com caractere nao alfanumerico (previne SQL injection)', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['id; DROP TABLE--'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('nome de coluna invalido');
  });

  it('rejeita nome de coluna de filtro com caractere nao alfanumerico', () => {
    const q: ReportQuery = {
      view: 'atendimentos',
      filters: [{ column: 'x OR 1=1', op: 'eq', value: 'v' }],
      columns: { visible: ['id'] },
      sort: [],
      limit: 50,
      offset: 0,
    };
    expect(() => buildQuery(q)).toThrow('nome de coluna invalido');
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/query-builder.test.ts
```

Saida esperada: falha com `Cannot find module './query-builder'` ou `buildQuery is not a function`.

- [ ] Implementar o query builder:

```ts
// packages/reports/src/query-builder.ts
import { ValidationError } from '@cadencia/kernel';
import type { BuiltQuery, ReportQuery, ReportFilter, FilterOp } from './types';

/** Views permitidas — unico ponto de whitelist. */
const ALLOWED_VIEWS = new Set(['atendimentos', 'financeiro', 'pacientes', 'mensagens']);

/** Regex para validar nomes de colunas: so letras, numeros e underscore. */
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
 * NUNCA interpola valores — tudo via $N. Nomes de colunas e views sao validados
 * contra whitelist e regex. O SQL resultante roda sobre app_rpt views, que ja
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

  // Validar colunas visiveis
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/query-builder.test.ts
```

Saida esperada: todos os 11 testes passam.

- [ ] Atualizar o index para reexportar:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
```

- [ ] Commitar:

```bash
git add packages/reports/src/types.ts packages/reports/src/query-builder.ts \
      packages/reports/src/query-builder.test.ts packages/reports/src/index.ts \
      packages/reports/package.json
git commit -m "feat(reports): add report types and query builder for Explorar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 45: 11 visoes salvas built-in e visoes customizadas — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/saved-views.ts`
- Criar `packages/reports/src/saved-views.test.ts`
- Modificar `packages/reports/src/index.ts`

**Por que**: as 11 visoes salvas mapeiam 1:1 os relatorios do iClinic — nomes preservados para custo zero de migracao. Cada visao e um conjunto de filtros + colunas + ordenacao + grafico default. O usuario pode salvar visoes customizadas. O dominio de visoes vive em `packages/reports` sem acesso ao banco — persistencia de visoes customizadas fica na API (L3).

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/saved-views.test.ts
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  validateCustomViewInput,
} from './saved-views';
import type { CustomViewInput, SavedView } from './types';

describe('visoes salvas built-in', () => {
  it('contem exatamente 11 visoes', () => {
    expect(BUILT_IN_VIEWS).toHaveLength(11);
  });

  it('todas as visoes tem id, nome e sao built-in', () => {
    for (const v of BUILT_IN_VIEWS) {
      expect(v.id).toBeTruthy();
      expect(v.name).toBeTruthy();
      expect(v.builtIn).toBe(true);
    }
  });

  it('visao "Atendimentos realizados" usa view atendimentos com filtro de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Atendimentos realizados');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'realizado')).toBe(true);
  });

  it('visao "Pacientes para retorno" usa view atendimentos', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Pacientes para retorno');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
  });

  it('visao "Por periodo" usa view atendimentos sem filtro fixo de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por periodo');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.every((f) => f.column !== 'status')).toBe(true);
  });

  it('visao "Por CID" usa view atendimentos e agrupa por cid_code', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por CID');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.columns.groupBy).toBe('cid_code');
  });

  it('visao "Por indicacao" usa view pacientes e agrupa por referral_source', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por indicacao');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.columns.groupBy).toBe('referral_source');
  });

  it('visao "Faltas" usa view atendimentos com filtro de status falta', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Faltas');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'falta')).toBe(true);
  });

  it('visao "Analises financeiras" usa view financeiro', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Analises financeiras');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
  });

  it('visao "Repasse" usa view financeiro e agrupa por professional_name', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Repasse');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.columns.groupBy).toBe('professional_name');
  });

  it('visao "Fluxo de caixa" usa view financeiro com basis caixa', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Fluxo de caixa');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.filters.some((f) => f.column === 'basis' && f.value === 'caixa')).toBe(true);
  });

  it('visao "Envios" usa view mensagens', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Envios');
    expect(v).toBeDefined();
    expect(v!.view).toBe('mensagens');
  });

  it('visao "Aniversariantes" usa view pacientes e ordena por birth_month_day', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Aniversariantes');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.sort.some((s) => s.column === 'birth_month_day')).toBe(true);
  });
});

describe('getSavedView', () => {
  it('retorna visao por id quando existe', () => {
    const primeira = BUILT_IN_VIEWS[0]!;
    const result = getSavedView(primeira.id);
    expect(result).toEqual(primeira);
  });

  it('retorna undefined quando id nao existe', () => {
    expect(getSavedView('inexistente')).toBeUndefined();
  });
});

describe('validateCustomViewInput', () => {
  it('aceita input valido', () => {
    const input: CustomViewInput = {
      name: 'Minha visao',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const input: CustomViewInput = {
      name: '',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita view invalida', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'inexistente' as any,
      filters: [],
      columns: { visible: ['id'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita coluna com caractere invalido', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['id; DROP'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/saved-views.test.ts
```

Saida esperada: falha com `Cannot find module './saved-views'`.

- [ ] Implementar as visoes salvas:

```ts
// packages/reports/src/saved-views.ts
import { ValidationError } from '@cadencia/kernel';
import { ok, err, type Result } from '@cadencia/kernel';
import type { SavedView, CustomViewInput } from './types';

const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;
const ALLOWED_VIEWS = new Set(['atendimentos', 'financeiro', 'pacientes', 'mensagens']);

/**
 * As 11 visoes salvas built-in. Nomes preservados do iClinic para custo zero de
 * migracao. Cada visao e um conjunto de filtros + colunas + ordenacao + grafico.
 */
export const BUILT_IN_VIEWS: readonly SavedView[] = Object.freeze([
  // 1. Atendimentos realizados
  {
    id: 'builtin-atendimentos-realizados',
    name: 'Atendimentos realizados',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'realizado' }],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'procedure_name', 'status'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 2. Pacientes para retorno
  {
    id: 'builtin-pacientes-retorno',
    name: 'Pacientes para retorno',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'return_due', op: 'eq', value: true }],
    columns: {
      visible: ['patient_name', 'professional_name', 'last_visit_date', 'return_due_date', 'phone'],
    },
    sort: [{ column: 'return_due_date', dir: 'asc' }],
    chartKind: 'table',
  },
  // 3. Por periodo
  {
    id: 'builtin-por-periodo',
    name: 'Por periodo',
    builtIn: true,
    view: 'atendimentos',
    filters: [],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'procedure_name', 'status'],
      groupBy: 'occurred_date',
      aggregate: { column: 'occurred_date', fn: 'count' },
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'line',
  },
  // 4. Por CID
  {
    id: 'builtin-por-cid',
    name: 'Por CID',
    builtIn: true,
    view: 'atendimentos',
    filters: [],
    columns: {
      visible: ['cid_code', 'cid_description'],
      groupBy: 'cid_code',
      aggregate: { column: 'cid_code', fn: 'count' },
    },
    sort: [{ column: 'cid_code', dir: 'asc' }],
    chartKind: 'bar',
  },
  // 5. Por indicacao
  {
    id: 'builtin-por-indicacao',
    name: 'Por indicacao',
    builtIn: true,
    view: 'pacientes',
    filters: [],
    columns: {
      visible: ['referral_source'],
      groupBy: 'referral_source',
      aggregate: { column: 'referral_source', fn: 'count' },
    },
    sort: [{ column: 'referral_source', dir: 'asc' }],
    chartKind: 'pie',
  },
  // 6. Faltas
  {
    id: 'builtin-faltas',
    name: 'Faltas',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'falta' }],
    columns: {
      visible: ['occurred_date', 'patient_name', 'professional_name', 'day_of_week', 'time_slot'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 7. Analises financeiras
  {
    id: 'builtin-analises-financeiras',
    name: 'Analises financeiras',
    builtIn: true,
    view: 'financeiro',
    filters: [],
    columns: {
      visible: ['occurred_date', 'category_name', 'kind', 'amount_cents', 'status'],
      groupBy: 'category_name',
      aggregate: { column: 'amount_cents', fn: 'sum' },
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 8. Repasse
  {
    id: 'builtin-repasse',
    name: 'Repasse',
    builtIn: true,
    view: 'financeiro',
    filters: [],
    columns: {
      visible: ['professional_name', 'amount_cents'],
      groupBy: 'professional_name',
      aggregate: { column: 'amount_cents', fn: 'sum' },
    },
    sort: [{ column: 'professional_name', dir: 'asc' }],
    chartKind: 'table',
  },
  // 9. Fluxo de caixa
  {
    id: 'builtin-fluxo-de-caixa',
    name: 'Fluxo de caixa',
    builtIn: true,
    view: 'financeiro',
    filters: [{ column: 'basis', op: 'eq', value: 'caixa' }],
    columns: {
      visible: ['occurred_date', 'kind', 'category_name', 'amount_cents', 'status'],
    },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'line',
  },
  // 10. Envios (SMS/WhatsApp)
  {
    id: 'builtin-envios',
    name: 'Envios',
    builtIn: true,
    view: 'mensagens',
    filters: [],
    columns: {
      visible: ['sent_at', 'channel', 'template_name', 'patient_name', 'status'],
      groupBy: 'channel',
      aggregate: { column: 'channel', fn: 'count' },
    },
    sort: [{ column: 'sent_at', dir: 'desc' }],
    chartKind: 'bar',
  },
  // 11. Aniversariantes
  {
    id: 'builtin-aniversariantes',
    name: 'Aniversariantes',
    builtIn: true,
    view: 'pacientes',
    filters: [],
    columns: {
      visible: ['patient_name', 'birth_date', 'birth_month_day', 'phone', 'age'],
    },
    sort: [{ column: 'birth_month_day', dir: 'asc' }],
    chartKind: 'table',
  },
] as const);

const VIEW_INDEX = new Map(BUILT_IN_VIEWS.map((v) => [v.id, v]));

/** Busca uma visao salva por id (built-in). */
export function getSavedView(viewId: string): SavedView | undefined {
  return VIEW_INDEX.get(viewId);
}

/** Valida input de visao customizada do usuario. */
export function validateCustomViewInput(
  input: CustomViewInput,
): Result<CustomViewInput, ValidationError> {
  if (input.name.trim().length === 0) {
    return err(new ValidationError(
      'report.view.nome_vazio',
      'o nome da visao nao pode ser vazio',
    ));
  }

  if (!ALLOWED_VIEWS.has(input.view)) {
    return err(new ValidationError(
      'report.view.view_invalida',
      'a view informada nao e permitida',
      { view: input.view },
    ));
  }

  for (const col of input.columns.visible) {
    if (!COLUMN_RE.test(col)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna invalido na definicao da visao',
        { column: col },
      ));
    }
  }

  if (input.columns.groupBy !== undefined && !COLUMN_RE.test(input.columns.groupBy)) {
    return err(new ValidationError(
      'report.view.coluna_invalida',
      'nome de coluna de agrupamento invalido',
      { column: input.columns.groupBy },
    ));
  }

  for (const s of input.sort) {
    if (!COLUMN_RE.test(s.column)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna de ordenacao invalido',
        { column: s.column },
      ));
    }
  }

  for (const f of input.filters) {
    if (!COLUMN_RE.test(f.column)) {
      return err(new ValidationError(
        'report.view.coluna_invalida',
        'nome de coluna de filtro invalido',
        { column: f.column },
      ));
    }
  }

  return ok(input);
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/saved-views.test.ts
```

Saida esperada: todos os 17 testes passam.

- [ ] Atualizar o index:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
export { BUILT_IN_VIEWS, getSavedView, validateCustomViewInput } from './saved-views';
```

- [ ] Commitar:

```bash
git add packages/reports/src/saved-views.ts packages/reports/src/saved-views.test.ts \
      packages/reports/src/index.ts
git commit -m "feat(reports): add 11 built-in saved views and custom view validation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 46: Exportacao CSV e XLSX — `packages/reports`

**Arquivos**

- Criar `packages/reports/src/export.ts`
- Criar `packages/reports/src/export.test.ts`
- Modificar `packages/reports/src/index.ts`
- Modificar `packages/reports/package.json`

**Por que**: o Explorar precisa exportar os dados filtrados em CSV e XLSX. CSV e gerado nativamente (sem dependencia). XLSX usa SheetJS (`xlsx`, pacote sem dependencia externa). A funcao `exportReport` recebe as linhas ja filtradas (a consulta roda na API, nao aqui) e devolve um Buffer. O dominio nao acessa banco — so transforma dados em formato de arquivo.

- [ ] Adicionar a dependencia de SheetJS ao package.json:

```jsonc
// packages/reports/package.json
{
  "name": "@cadencia/reports",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  }
}
```

- [ ] Escrever o teste que falha:

```ts
// packages/reports/src/export.test.ts
import { describe, expect, it } from 'vitest';
import { exportReport } from './export';
import type { ExportFormat } from './types';

const LINHAS = [
  { professional_name: 'Dra. Ana', patient_name: 'Carlos', occurred_date: '2026-07-15', status: 'realizado' },
  { professional_name: 'Dr. Bruno', patient_name: 'Maria', occurred_date: '2026-07-16', status: 'realizado' },
];

const COLUNAS = ['professional_name', 'patient_name', 'occurred_date', 'status'];

const CABECALHOS: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
};

describe('exportReport CSV', () => {
  it('gera CSV com cabecalho e linhas separadas por ponto e virgula', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
    expect(linhas[1]).toBe('Dra. Ana;Carlos;2026-07-15;realizado');
    expect(linhas[2]).toBe('Dr. Bruno;Maria;2026-07-16;realizado');
    expect(linhas).toHaveLength(3);
  });

  it('escapa campos com ponto e virgula usando aspas', () => {
    const linhas = [{ a: 'valor;com;pv', b: 'normal' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor;com;pv"');
  });

  it('escapa campos com aspas duplicando-as', () => {
    const linhas = [{ a: 'valor "com" aspas', b: 'ok' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor ""com"" aspas"');
  });

  it('retorna buffer vazio para linhas vazias (so cabecalho)', () => {
    const buf = exportReport([], COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
  });

  it('inclui BOM UTF-8 no inicio do CSV', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    expect(buf[0]).toBe(0xEF);
    expect(buf[1]).toBe(0xBB);
    expect(buf[2]).toBe(0xBF);
  });
});

describe('exportReport XLSX', () => {
  it('gera Buffer nao vazio com assinatura de arquivo XLSX (PK zip)', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4B); // K
  });

  it('contem os dados quando reparseado', () => {
    const XLSX = require('xlsx');
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
    expect(data).toHaveLength(2);
    expect(data[0]!['Profissional']).toBe('Dra. Ana');
    expect(data[1]!['Paciente']).toBe('Maria');
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "packages/reports" && pnpm vitest run src/export.test.ts
```

Saida esperada: falha com `Cannot find module './export'`.

- [ ] Implementar a exportacao:

```ts
// packages/reports/src/export.ts
import type { ExportFormat } from './types';
import * as XLSX from 'xlsx';

const SEPARATOR = ';';
const BOM = '﻿';

function escapeCsvField(value: string): string {
  if (value.includes(SEPARATOR) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerLine = columns.map((c) => escapeCsvField(headers[c] ?? c)).join(SEPARATOR);
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(row[c] ?? ''))).join(SEPARATOR),
  );
  const content = BOM + [headerLine, ...dataLines].join('\n');
  return Buffer.from(content, 'utf-8');
}

function toXlsx(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerRow = columns.map((c) => headers[c] ?? c);
  const dataRows = rows.map((row) => columns.map((c) => row[c] ?? ''));
  const aoa = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

/**
 * Exporta linhas ja filtradas para CSV ou XLSX.
 *
 * CSV usa ponto e virgula como separador (padrao brasileiro — Excel pt-BR abre
 * direto) e inclui BOM UTF-8 para que o Excel reconheca a codificacao.
 * XLSX usa SheetJS para gerar o arquivo binario.
 *
 * A funcao NAO acessa banco. Recebe dados ja consultados pela API.
 */
export function exportReport(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
  format: ExportFormat,
): Buffer {
  switch (format) {
    case 'csv':
      return toCsv(rows, columns, headers);
    case 'xlsx':
      return toXlsx(rows, columns, headers);
  }
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "packages/reports" && pnpm vitest run src/export.test.ts
```

Saida esperada: todos os 7 testes passam.

- [ ] Atualizar o index:

```ts
// packages/reports/src/index.ts
export * from './types';
export { buildQuery } from './query-builder';
export { BUILT_IN_VIEWS, getSavedView, validateCustomViewInput } from './saved-views';
export { exportReport } from './export';
```

- [ ] Commitar:

```bash
git add packages/reports/src/export.ts packages/reports/src/export.test.ts \
      packages/reports/src/index.ts packages/reports/package.json
git commit -m "feat(reports): add CSV and XLSX export with SheetJS

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 47: Acao `report.read` no authz e rotas da API — Explorar, visoes e exportacao

**Arquivos**

- Modificar `packages/authz/src/actions.ts`
- Criar `apps/api/src/routes/reports.ts`
- Criar `apps/api/src/routes/reports.int.test.ts`
- Modificar `apps/api/package.json`

**Por que**: o Explorar precisa de rotas protegidas para consultar, listar visoes salvas, salvar visoes customizadas e exportar. A acao `report.read` controla o acesso. As rotas vivem em L3 e compoem `@cadencia/reports` (L2) com `@cadencia/db` (L0) para executar o SQL montado pelo query builder.

- [ ] Adicionar a acao `report.read` ao catalogo de acoes:

```ts
// packages/authz/src/actions.ts
// Adicionar ao final do array ACTIONS, antes do `] as const satisfies`:
  // -- Fase 3 . Desempenho -------------------------------------------------
  { key: 'report.read', description: 'Consultar relatorios e exportar dados',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'report.view.write', description: 'Salvar visao customizada de relatorio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
```

- [ ] Adicionar dependencia do `@cadencia/reports` ao api:

```jsonc
// apps/api/package.json  — adicionar ao "dependencies":
    "@cadencia/reports": "workspace:*",
```

- [ ] Escrever o teste de integracao que falha:

```ts
// apps/api/src/routes/reports.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { reportRoutes } from './reports';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  // Registrar as rotas sem autenticacao para teste unitario de contrato
  // (teste de integracao com banco e com authn/authz roda no CI)
  await app.register(async (instance) => {
    await reportRoutes(instance);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('rotas de relatorio — contrato HTTP', () => {
  it('GET /v1/reports/views retorna array com as 11 visoes built-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.views).toHaveLength(11);
    expect(body.views[0]).toHaveProperty('id');
    expect(body.views[0]).toHaveProperty('name');
    expect(body.views[0]).toHaveProperty('builtIn', true);
  });

  it('GET /v1/reports/views/:id retorna visao especifica', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/reports/views/builtin-atendimentos-realizados',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('builtin-atendimentos-realizados');
    expect(body.name).toBe('Atendimentos realizados');
  });

  it('GET /v1/reports/views/:id retorna 404 para id inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views/nao-existe' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/api" && pnpm vitest run src/routes/reports.int.test.ts
```

Saida esperada: falha com `Cannot find module './reports'`.

- [ ] Implementar as rotas:

```ts
// apps/api/src/routes/reports.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  buildQuery,
  exportReport,
  validateCustomViewInput,
  type ReportQuery,
  type ExportFormat,
} from '@cadencia/reports';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const FilterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'like']),
  value: z.unknown(),
});

const SortSchema = z.object({
  column: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
});

const ColumnsSchema = z.object({
  visible: z.array(z.string().min(1)).min(1),
  groupBy: z.string().optional(),
  aggregate: z.object({
    column: z.string(),
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  }).optional(),
});

const QuerySchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  limit: z.number().int().min(1).max(5000).default(50),
  offset: z.number().int().min(0).default(0),
});

const ExportSchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  format: z.enum(['csv', 'xlsx']),
  headers: z.record(z.string()).default({}),
});

const CustomViewSchema = z.object({
  name: z.string().min(1).max(120),
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  chartKind: z.enum(['bar', 'line', 'pie', 'table']).default('table'),
});

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor (centavos)',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descricao CID',
  referral_source: 'Indicacao',
  basis: 'Base',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa de horario',
  last_visit_date: 'Ultima visita',
  return_due_date: 'Retorno previsto',
};

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- GET /v1/reports/views — listar visoes salvas -----------------------
  r.get('/v1/reports/views', {
    schema: {
      response: {
        200: z.object({
          views: z.array(z.object({
            id: z.string(),
            name: z.string(),
            builtIn: z.boolean(),
            view: z.string(),
            chartKind: z.string(),
          })),
        }),
      },
    },
  }, async () => {
    return {
      views: BUILT_IN_VIEWS.map((v) => ({
        id: v.id,
        name: v.name,
        builtIn: v.builtIn,
        view: v.view,
        chartKind: v.chartKind,
      })),
    };
  });

  // -- GET /v1/reports/views/:id — obter visao por id ---------------------
  r.get('/v1/reports/views/:id', {
    schema: {
      params: z.object({ id: z.string() }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = getSavedView(id);
    if (view === undefined) {
      void reply.code(404);
      return { erro: 'visao_nao_encontrada', id };
    }
    return view;
  });

  // -- POST /v1/reports/query — executar consulta do Explorar -------------
  r.post('/v1/reports/query', {
    schema: {
      body: QuerySchema,
    },
  }, rota('report.read', async (tx, _ctx, req) => {
    const body = req.body as ReportQuery;
    const built = buildQuery(body);
    const { rows } = await tx.query(built.sql, [...built.params]);
    return { rows, total: rows.length };
  }));

  // -- POST /v1/reports/export — exportar dados filtrados -----------------
  r.post('/v1/reports/export', {
    schema: {
      body: ExportSchema,
    },
  }, rota('report.read', async (tx, _ctx, req, reply) => {
    const body = req.body as {
      view: string; filters: any[]; columns: any; sort: any[];
      format: ExportFormat; headers: Record<string, string>;
    };

    const query: ReportQuery = {
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      limit: 50000,
      offset: 0,
    };
    const built = buildQuery(query);
    const { rows } = await tx.query(built.sql, [...built.params]);

    const columns = body.columns.visible as string[];
    const headers = { ...HEADER_MAP, ...body.headers };
    const buf = exportReport(rows, columns, headers, body.format);

    const mime = body.format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = body.format === 'csv' ? 'csv' : 'xlsx';

    void reply.header('content-type', mime);
    void reply.header('content-disposition',
      `attachment; filename="relatorio.${ext}"`);
    return buf;
  }));

  // -- POST /v1/reports/views/custom — salvar visao customizada -----------
  r.post('/v1/reports/views/custom', {
    schema: {
      body: CustomViewSchema,
      response: {
        201: z.object({ viewId: z.string().uuid() }),
      },
    },
  }, rota('report.view.write', async (tx, ctx, req, reply) => {
    const body = req.body as {
      name: string; view: string; filters: any[];
      columns: any; sort: any[]; chartKind: string;
    };

    const result = validateCustomViewInput({
      name: body.name,
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      chartKind: body.chartKind as any,
    });

    if (!result.ok) {
      void reply.code(422);
      return { erro: result.error.code, mensagem: result.error.message };
    }

    const viewId = uuidv7();

    await tx.query(
      `INSERT INTO app.saved_report_view
         (id, user_id, name, view_name, filters, columns, sort, chart_kind)
       VALUES ($1, app.current_user_id(), $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
      [viewId, body.name, body.view,
       JSON.stringify(body.filters), JSON.stringify(body.columns),
       JSON.stringify(body.sort), body.chartKind]);

    void reply.code(201);
    return { viewId };
  }));
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/api" && pnpm vitest run src/routes/reports.int.test.ts
```

Saida esperada: os 3 testes de contrato HTTP passam.

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts apps/api/src/routes/reports.ts \
      apps/api/src/routes/reports.int.test.ts apps/api/package.json
git commit -m "feat(api): add report routes for Explorar, saved views and export

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 48: Tela Explorar — query builder visual com filtros combinaveis

**Arquivos**

- Criar `apps/web/src/telas/Explorar.tsx`
- Criar `apps/web/src/telas/Explorar.test.tsx`

**Por que**: o Explorar e a tela central do Desempenho. Permite combinar filtros (periodo, profissional, clinica, procedimento, convenio, status, CID, faixa etaria, genero, fonte) e ver o resultado em tabela com colunas configuraveis. O grafico (visx) vem na Task 49. Aqui o foco e o layout de filtros, a tabela de resultado e a integracao com as visoes salvas.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar } from './Explorar';
import type { SavedView } from '@cadencia/reports';

const VISOES_MOCK: SavedView[] = [
  {
    id: 'builtin-atendimentos-realizados',
    name: 'Atendimentos realizados',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'realizado' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  {
    id: 'builtin-faltas',
    name: 'Faltas',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'falta' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
];

const LINHAS_MOCK = [
  { occurred_date: '2026-07-15', patient_name: 'Carlos', professional_name: 'Dra. Ana', status: 'realizado' },
  { occurred_date: '2026-07-16', patient_name: 'Maria', professional_name: 'Dr. Bruno', status: 'realizado' },
];

function montar(overrides: Partial<Parameters<typeof Explorar>[0]> = {}) {
  const props = {
    visoesSalvas: VISOES_MOCK,
    aoConsultar: vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 })),
    aoExportar: vi.fn(async () => {}),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'custom-1' })),
    ...overrides,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('renderiza o titulo "Explorar"', () => {
    montar();
    expect(screen.getByRole('heading', { name: /Explorar/ })).toBeVisible();
  });

  it('exibe lista de visoes salvas como botoes de acesso rapido', () => {
    montar();
    expect(screen.getByRole('button', { name: /Atendimentos realizados/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Faltas/ })).toBeVisible();
  });

  it('ao clicar em visao salva, carrega filtros e dispara consulta', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(props.aoConsultar).toHaveBeenCalled());
  });

  it('exibe seletor de periodo com campos de data inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data fim/i)).toBeInTheDocument();
  });

  it('exibe tabela de resultados apos consulta', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByText('Carlos')).toBeVisible();
    expect(screen.getByText('Maria')).toBeVisible();
  });

  it('exibe cabecalhos de coluna na tabela', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByRole('columnheader', { name: /Data/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Paciente/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Profissional/ })).toBeVisible();
  });

  it('exibe botoes de exportar CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /XLSX/ })).toBeVisible();
  });

  it('ao clicar em exportar CSV chama aoExportar com formato csv', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() => expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv' }),
    ));
  });

  it('exibe botao "Salvar visao" e chama aoSalvarVisao com nome', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Salvar visao/ }));
    const campo = screen.getByLabelText(/Nome da visao/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Minha visao');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(props.aoSalvarVisao).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minha visao' }),
    ));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        visoesSalvas={VISOES_MOCK}
        aoConsultar={vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 }))}
        aoExportar={vi.fn(async () => {})}
        aoSalvarVisao={vi.fn(async () => ({ viewId: 'custom-1' }))}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx
```

Saida esperada: falha com `Cannot find module './Explorar'`.

- [ ] Implementar a tela Explorar:

```tsx
// apps/web/src/telas/Explorar.tsx
'use client';

import { useCallback, useState } from 'react';
import { Botao } from '../ui/Botao';
import type { SavedView, ReportFilter, ReportColumns, ReportSort, ChartKind, ExportFormat } from '@cadencia/reports';

export interface ResultadoConsulta {
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
}

export interface ExplorarProps {
  readonly visoesSalvas: readonly SavedView[];
  readonly aoConsultar: (query: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    limit: number;
    offset: number;
  }) => Promise<ResultadoConsulta>;
  readonly aoExportar: (params: {
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    format: ExportFormat;
  }) => Promise<void>;
  readonly aoSalvarVisao: (params: {
    name: string;
    view: string;
    filters: readonly ReportFilter[];
    columns: ReportColumns;
    sort: readonly ReportSort[];
    chartKind: ChartKind;
  }) => Promise<{ viewId: string }>;
}

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descricao CID',
  referral_source: 'Indicacao',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa horario',
  last_visit_date: 'Ultima visita',
  return_due_date: 'Retorno previsto',
};

export function Explorar(p: ExplorarProps) {
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [visaoAtual, setVisaoAtual] = useState<SavedView | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [nomeVisao, setNomeVisao] = useState('');

  const consultar = useCallback(async (visao: SavedView) => {
    setCarregando(true);
    setVisaoAtual(visao);
    try {
      const filtros = [...visao.filters];
      if (dataInicio !== '' && dataFim !== '') {
        filtros.push({ column: 'occurred_date', op: 'between', value: [dataInicio, dataFim] });
      }
      const res = await p.aoConsultar({
        view: visao.view,
        filters: filtros,
        columns: visao.columns,
        sort: visao.sort,
        limit: 200,
        offset: 0,
      });
      setResultado(res);
    } finally {
      setCarregando(false);
    }
  }, [p, dataInicio, dataFim]);

  const exportar = useCallback(async (format: ExportFormat) => {
    if (visaoAtual === null) return;
    await p.aoExportar({
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      format,
    });
  }, [p, visaoAtual]);

  const salvarVisao = useCallback(async () => {
    if (visaoAtual === null || nomeVisao.trim() === '') return;
    await p.aoSalvarVisao({
      name: nomeVisao,
      view: visaoAtual.view,
      filters: visaoAtual.filters,
      columns: visaoAtual.columns,
      sort: visaoAtual.sort,
      chartKind: visaoAtual.chartKind,
    });
    setSalvando(false);
    setNomeVisao('');
  }, [p, visaoAtual, nomeVisao]);

  const colunas = visaoAtual !== null
    ? visaoAtual.columns.visible
    : [];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Explorar
      </h1>

      {/* Visoes salvas */}
      <section aria-label="Visoes salvas" style={{ display: 'flex', flexWrap: 'wrap',
                                                    gap: 'var(--s-3)' }}>
        {p.visoesSalvas.map((v) => (
          <Botao key={v.id} variante="secundario" altura={32}
            onClick={() => { void consultar(v); }}>
            {v.name}
          </Botao>
        ))}
      </section>

      {/* Filtros de periodo */}
      <section aria-label="Filtros" style={{ display: 'flex', gap: 'var(--s-4)',
                                              alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="data-inicio"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data inicio
          </label>
          <input id="data-inicio" type="date" value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <div>
          <label htmlFor="data-fim"
            style={{ display: 'block', fontSize: 'var(--fs-12)',
                     color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
            Data fim
          </label>
          <input id="data-fim" type="date" value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                     borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                     background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <Botao variante="secundario" altura={32}
          onClick={() => { if (visaoAtual !== null) void consultar(visaoAtual); }}>
          Aplicar filtro
        </Botao>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-2)' }}>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('csv'); }}>
            CSV
          </Botao>
          <Botao variante="fantasma" altura={28}
            onClick={() => { void exportar('xlsx'); }}>
            XLSX
          </Botao>
        </div>
      </section>

      {/* Tabela de resultados */}
      {resultado !== null && colunas.length > 0 ? (
        <section aria-label="Resultado" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-14)' }}>
            <thead>
              <tr>
                {colunas.map((col) => (
                  <th key={col} scope="col"
                    style={{ textAlign: 'left', padding: 'var(--s-3) var(--s-4)',
                             borderBottom: '2px solid var(--line-strong)',
                             fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-12)',
                             color: 'var(--text-muted)', textTransform: 'uppercase',
                             letterSpacing: '.04em' }}>
                    {HEADER_MAP[col] ?? col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultado.rows.map((row, i) => (
                <tr key={i}>
                  {colunas.map((col) => (
                    <td key={col}
                      style={{ padding: 'var(--s-3) var(--s-4)',
                               borderBottom: 'var(--border)' }}>
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                      marginTop: 'var(--s-3)' }}>
            {resultado.total} resultado{resultado.total !== 1 ? 's' : ''}
          </p>
        </section>
      ) : carregando ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-14)' }}>
          Carregando...
        </p>
      ) : null}

      {/* Salvar visao */}
      {visaoAtual !== null ? (
        <section aria-label="Salvar visao" style={{ display: 'flex', gap: 'var(--s-3)',
                                                     alignItems: 'end' }}>
          {salvando ? (
            <>
              <div>
                <label htmlFor="nome-visao"
                  style={{ display: 'block', fontSize: 'var(--fs-12)',
                           color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
                  Nome da visao
                </label>
                <input id="nome-visao" type="text" value={nomeVisao}
                  onChange={(e) => setNomeVisao(e.target.value)}
                  style={{ padding: 'var(--s-2) var(--s-3)', border: 'var(--border)',
                           borderRadius: 'var(--r-md)', fontSize: 'var(--fs-14)',
                           background: 'var(--surface)', color: 'var(--text)',
                           minWidth: 200 }} />
              </div>
              <Botao variante="primario" altura={32}
                onClick={() => { void salvarVisao(); }}>
                Confirmar
              </Botao>
              <Botao variante="fantasma" altura={32}
                onClick={() => { setSalvando(false); setNomeVisao(''); }}>
                Cancelar
              </Botao>
            </>
          ) : (
            <Botao variante="secundario" altura={32}
              onClick={() => setSalvando(true)}>
              Salvar visao
            </Botao>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx
```

Saida esperada: todos os 10 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/telas/Explorar.tsx apps/web/src/telas/Explorar.test.tsx
git commit -m "feat(web): add Explorar screen with filters, table and saved views

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 49: Grafico visx no Explorar — barra, linha e pizza

**Arquivos**

- Criar `apps/web/src/ui/GraficoExplorar.tsx`
- Criar `apps/web/src/ui/GraficoExplorar.test.tsx`
- Modificar `apps/web/src/telas/Explorar.tsx`
- Modificar `apps/web/package.json`

**Por que**: o Explorar mostra um grafico (visx) abaixo dos filtros e acima da tabela. O tipo de grafico depende da visao (bar, line, pie). O componente recebe dados ja filtrados e o tipo de grafico. visx e a stack escolhida (Design §2.3) por permitir graficos customizados sem Recharts.

- [ ] Adicionar visx ao package.json do web:

```jsonc
// apps/web/package.json — adicionar ao "dependencies":
    "@visx/group": "^3.12.0",
    "@visx/scale": "^3.12.0",
    "@visx/shape": "^3.12.0",
    "@visx/axis": "^3.12.0",
    "@visx/responsive": "^3.12.0",
```

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/GraficoExplorar.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { GraficoExplorar } from './GraficoExplorar';

const DADOS_BARRA = [
  { label: 'Jan', value: 100 },
  { label: 'Fev', value: 200 },
  { label: 'Mar', value: 150 },
];

const DADOS_LINHA = [
  { label: '2026-07-01', value: 30 },
  { label: '2026-07-02', value: 45 },
  { label: '2026-07-03', value: 20 },
];

const DADOS_PIZZA = [
  { label: 'Pix', value: 400 },
  { label: 'Cartao', value: 300 },
  { label: 'Dinheiro', value: 200 },
];

describe('GraficoExplorar', () => {
  it('renderiza SVG acessivel para grafico de barras', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de linha', () => {
    render(<GraficoExplorar tipo="line" dados={DADOS_LINHA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('renderiza SVG acessivel para grafico de pizza', () => {
    render(<GraficoExplorar tipo="pie" dados={DADOS_PIZZA}
      largura={400} altura={200} />);
    expect(screen.getByRole('img', { name: /grafico/i })).toBeVisible();
  });

  it('nao renderiza nada para tipo table', () => {
    const { container } = render(
      <GraficoExplorar tipo="table" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renderiza barras com quantidade correta de retangulos', () => {
    render(<GraficoExplorar tipo="bar" dados={DADOS_BARRA}
      largura={400} altura={200} />);
    const svg = screen.getByRole('img', { name: /grafico/i });
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it('sem violacao de acessibilidade no grafico de barras', async () => {
    const { container } = render(
      <GraficoExplorar tipo="bar" dados={DADOS_BARRA}
        largura={400} altura={200} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/ui/GraficoExplorar.test.tsx
```

Saida esperada: falha com `Cannot find module './GraficoExplorar'`.

- [ ] Implementar o componente de grafico:

```tsx
// apps/web/src/ui/GraficoExplorar.tsx
'use client';

import type { ChartKind } from '@cadencia/reports';

export interface DadoGrafico {
  readonly label: string;
  readonly value: number;
}

export interface GraficoExplorarProps {
  readonly tipo: ChartKind;
  readonly dados: readonly DadoGrafico[];
  readonly largura: number;
  readonly altura: number;
}

const MARGEM = { top: 20, right: 20, bottom: 40, left: 50 };

const CORES = [
  'var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--danger)',
  'var(--ai)', 'var(--text-muted)',
];

function GraficoBarra({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);
  const barW = Math.max(innerW / dados.length - 4, 8);

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      {dados.map((d, i) => {
        const barH = (d.value / maxVal) * innerH;
        const x = (innerW / dados.length) * i + 2;
        const y = innerH - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={barH}
              rx={3} fill="var(--accent)"
              role="img" aria-label={`${d.label}: ${d.value}`} />
            <text x={x + barW / 2} y={innerH + 16}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {d.label.length > 6 ? d.label.slice(0, 6) : d.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GraficoLinha({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);

  const pontos = dados.map((d, i) => {
    const x = (innerW / Math.max(dados.length - 1, 1)) * i;
    const y = innerH - (d.value / maxVal) * innerH;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = pontos.map((pt, i) =>
    `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pontos.map((pt) => (
        <circle key={pt.label} cx={pt.x} cy={pt.y} r={3}
          fill="var(--accent)"
          role="img" aria-label={`${pt.label}: ${pt.value}`} />
      ))}
    </g>
  );
}

function GraficoPizza({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const cx = largura / 2;
  const cy = altura / 2;
  const r = Math.min(cx, cy) - 20;
  const total = dados.reduce((sum, d) => sum + d.value, 0) || 1;

  let angulo = -Math.PI / 2;
  const fatias = dados.map((d, i) => {
    const frac = d.value / total;
    const start = angulo;
    angulo += frac * 2 * Math.PI;
    const end = angulo;
    const largeArc = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { pathD, label: d.label, value: d.value, cor: CORES[i % CORES.length] };
  });

  return (
    <g>
      {fatias.map((f) => (
        <path key={f.label} d={f.pathD} fill={f.cor}
          role="img" aria-label={`${f.label}: ${f.value}`} />
      ))}
    </g>
  );
}

export function GraficoExplorar({ tipo, dados, largura, altura }: GraficoExplorarProps) {
  if (tipo === 'table' || dados.length === 0) {
    return null;
  }

  return (
    <svg role="img" aria-label="Grafico do relatorio"
      viewBox={`0 0 ${largura} ${altura}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${altura}px` }}>
      {tipo === 'bar' ? (
        <GraficoBarra dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'line' ? (
        <GraficoLinha dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'pie' ? (
        <GraficoPizza dados={dados} largura={largura} altura={altura} />
      ) : null}
    </svg>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 6 testes passam.

- [ ] Integrar o grafico na tela Explorar. Adicionar import e renderizacao do grafico no `Explorar.tsx`, logo acima da tabela de resultados:

```tsx
// apps/web/src/telas/Explorar.tsx
// Adicionar no topo, junto aos outros imports:
import { GraficoExplorar } from '../ui/GraficoExplorar';

// Adicionar dentro do componente, logo ANTES da section "Resultado",
// dentro do bloco {resultado !== null && colunas.length > 0 ? (...):
// Inserir logo antes de <section aria-label="Resultado"...>:
```

Conteudo a inserir no componente Explorar, logo antes da `<section aria-label="Resultado"`:

```tsx
      {resultado !== null && visaoAtual !== null && visaoAtual.chartKind !== 'table' ? (
        <section aria-label="Grafico" style={{ overflowX: 'auto' }}>
          <GraficoExplorar
            tipo={visaoAtual.chartKind}
            dados={
              visaoAtual.columns.groupBy !== undefined
                ? resultado.rows.map((row) => ({
                    label: String(row[visaoAtual.columns.groupBy!] ?? ''),
                    value: Number(
                      row[
                        visaoAtual.columns.aggregate !== undefined
                          ? `${visaoAtual.columns.aggregate.fn}_${visaoAtual.columns.aggregate.column}`
                          : visaoAtual.columns.visible[0]!
                      ] ?? 0,
                    ),
                  }))
                : resultado.rows.map((row) => ({
                    label: String(row[colunas[0]!] ?? ''),
                    value: Number(row[colunas[colunas.length - 1]!] ?? 0),
                  }))
            }
            largura={600}
            altura={260}
          />
        </section>
      ) : null}
```

- [ ] Rodar todos os testes do Explorar novamente para garantir que nada quebrou:

```bash
cd "apps/web" && pnpm vitest run src/telas/Explorar.test.tsx src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 16 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/ui/GraficoExplorar.tsx apps/web/src/ui/GraficoExplorar.test.tsx \
      apps/web/src/telas/Explorar.tsx apps/web/package.json
git commit -m "feat(web): add visx chart component and integrate with Explorar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 50: Navegacao Desempenho e FASE_ATUAL = 3

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Criar `apps/web/src/telas/Desempenho.tsx`
- Criar `apps/web/src/telas/Desempenho.test.tsx`

**Por que**: o Desempenho e a tela-mae que abriga o Explorar (e futuramente Variacoes do periodo, Atendimentos, Satisfacao). Ao subir FASE_ATUAL para 3, o link "Desempenho" aparece na navegacao. A tela renderiza o Explorar como conteudo principal.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Desempenho } from './Desempenho';

const PROPS_BASE = {
  visoesSalvas: [],
  aoConsultar: vi.fn(async () => ({ rows: [], total: 0 })),
  aoExportar: vi.fn(async () => {}),
  aoSalvarVisao: vi.fn(async () => ({ viewId: 'v1' })),
};

describe('tela Desempenho', () => {
  it('renderiza o titulo "Desempenho"', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('heading', { name: /Desempenho/ })).toBeVisible();
  });

  it('renderiza a sub-navegacao com aba "Explorar" ativa', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByRole('tab', { name: /Explorar/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renderiza o componente Explorar dentro', () => {
    render(<Desempenho {...PROPS_BASE} />);
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<Desempenho {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx
```

Saida esperada: falha com `Cannot find module './Desempenho'`.

- [ ] Implementar a tela Desempenho:

```tsx
// apps/web/src/telas/Desempenho.tsx
'use client';

import { useState } from 'react';
import { Explorar, type ExplorarProps } from './Explorar';

type AbaDesempenho = 'explorar' | 'variacoes' | 'atendimentos' | 'satisfacao';

const ABAS: readonly { id: AbaDesempenho; rotulo: string }[] = [
  { id: 'explorar', rotulo: 'Explorar' },
  { id: 'variacoes', rotulo: 'Variacoes do periodo' },
  { id: 'atendimentos', rotulo: 'Atendimentos' },
  { id: 'satisfacao', rotulo: 'Satisfacao' },
];

export type DesempenhoProps = ExplorarProps;

export function Desempenho(p: DesempenhoProps) {
  const [abaAtiva, setAbaAtiva] = useState<AbaDesempenho>('explorar');

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)',
                  maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Desempenho
      </h1>

      {/* Sub-navegacao */}
      <div role="tablist" aria-label="Abas do Desempenho"
        style={{ display: 'flex', gap: 'var(--s-1)',
                 borderBottom: '2px solid var(--line)' }}>
        {ABAS.map((aba) => (
          <button key={aba.id} role="tab"
            aria-selected={abaAtiva === aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            style={{
              padding: 'var(--s-3) var(--s-5)',
              fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: abaAtiva === aba.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: abaAtiva === aba.id
                ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {aba.rotulo}
          </button>
        ))}
      </div>

      {/* Conteudo da aba */}
      {abaAtiva === 'explorar' ? (
        <Explorar {...p} />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-14)',
                    padding: 'var(--s-8)' }}>
          Em breve
        </p>
      )}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx
```

Saida esperada: todos os 4 testes passam.

- [ ] Atualizar FASE_ATUAL para 3 na navegacao:

```ts
// apps/web/src/ui/nav.ts
// Alterar a ultima linha de:
//   export const FASE_ATUAL = 2 as const;
// Para:
export const FASE_ATUAL = 3 as const;
```

- [ ] Escrever teste para verificar que Desempenho agora aparece na navegacao:

```ts
// (adicionar ao final de apps/web/src/telas/Desempenho.test.tsx)

import { FASE_ATUAL, ITENS_NAV } from '../ui/nav';

describe('navegacao Desempenho', () => {
  it('FASE_ATUAL e 3', () => {
    expect(FASE_ATUAL).toBe(3);
  });

  it('item Desempenho esta disponivel na fase 3', () => {
    const item = ITENS_NAV.find((i) => i.rotulo === 'Desempenho');
    expect(item).toBeDefined();
    expect(item!.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
  });

  it('todos os itens de navegacao estao disponiveis na fase atual', () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });
});
```

- [ ] Rodar todos os testes do bloco para confirmar integridade:

```bash
cd "apps/web" && pnpm vitest run src/telas/Desempenho.test.tsx src/telas/Explorar.test.tsx src/ui/GraficoExplorar.test.tsx
```

Saida esperada: todos os 23 testes passam.

- [ ] Commitar:

```bash
git add apps/web/src/telas/Desempenho.tsx apps/web/src/telas/Desempenho.test.tsx \
      apps/web/src/ui/nav.ts
git commit -m "feat(web): add Desempenho screen, update FASE_ATUAL to 3

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
