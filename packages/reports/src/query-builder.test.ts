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
    expect(() => buildQuery(q)).toThrow('nome de coluna inválido');
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
    expect(() => buildQuery(q)).toThrow('nome de coluna inválido');
  });
});
