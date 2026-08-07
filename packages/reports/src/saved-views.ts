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
