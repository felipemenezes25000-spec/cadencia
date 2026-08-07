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
} from './types';
export {
  factorsAddUp,
  type DrillDownGroup,
  type DrillDownResult,
  type Period,
  type VariationFactors,
  type VariationSnapshot,
} from './variation-types';
