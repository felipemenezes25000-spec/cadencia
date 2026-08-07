// packages/reports/src/index.ts
export { refreshMatview, getLatestRefresh, MATVIEW_NAMES } from './refresh';
export type { MatviewName } from './refresh';
export { listAtendimentos, listAgenda, getRefreshTimestamps } from './queries';
export type {
  AtendimentoRow,
  FinanceiroRow,
  AgendaRow,
  PacienteRow,
  SatisfacaoRow,
  RefreshLogEntry,
  ReportView,
  FilterOp,
  ReportFilter,
  SortDir,
  ReportSort,
  ChartKind,
  ReportColumns,
  ReportQuery,
  BuiltQuery,
  ExportFormat,
  SavedView,
  CustomViewInput,
} from './types';
export { buildQuery } from './query-builder';
export { BUILT_IN_VIEWS, getSavedView, validateCustomViewInput } from './saved-views';
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
export { computeVariation } from './compute-variation';
export { drillDownFactor } from './drill-down-factor';
export { persistVariationSnapshot, readVariationSnapshot } from './persist-variation';
