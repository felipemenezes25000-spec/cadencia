// packages/reports/src/types.ts

/** Linha de rpt.mv_atendimentos exposta via app_rpt.atendimentos */
export interface AtendimentoRow {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly occurredDate: string;
  readonly durationMinutes: number | null;
  readonly procedureCodes: readonly string[];
  readonly diagnosisCodes: readonly string[];
  readonly versionCount: number;
  readonly status: string;
}

/** Linha de rpt.mv_financeiro exposta via app_rpt.financeiro */
export interface FinanceiroRow {
  readonly entryId: string;
  readonly kind: string;
  readonly category: string | null;
  readonly method: string | null;
  readonly amountCents: number;
  readonly paidAt: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly bankAccountId: string | null;
  readonly costCenterId: string | null;
}

/** Linha de rpt.mv_agenda exposta via app_rpt.agenda */
export interface AgendaRow {
  readonly appointmentDate: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly totalSlots: number;
  readonly booked: number;
  readonly confirmed: number;
  readonly attended: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly occupancyPct: number;
}

/** Linha de rpt.mv_pacientes exposta via app_rpt.pacientes */
export interface PacienteRow {
  readonly patientId: string;
  readonly ageBracket: string;
  readonly gender: string;
  readonly source: string | null;
  readonly firstVisit: string | null;
  readonly lastVisit: string | null;
  readonly visitCount: number;
}

/** Linha de rpt.mv_satisfacao exposta via app_rpt.satisfacao */
export interface SatisfacaoRow {
  readonly npsResponseId: string;
  readonly score: number;
  readonly category: 'promoter' | 'passive' | 'detractor';
  readonly professionalId: string | null;
  readonly clinicId: string | null;
  readonly respondedAt: string;
}

/** Registro de refresh em rpt.refresh_log */
export interface RefreshLogEntry {
  readonly id: number;
  readonly matviewName: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly rowCount: number;
  readonly success: boolean;
  readonly errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Tipos do Explorar — query builder sobre app_rpt views.
//
// Cada view em app_rpt expoe colunas desnormalizadas (tenant_id ja filtrado
// pela security_barrier). O Explorar monta SELECT/WHERE/ORDER dinamicamente
// a partir de filtros combinaveis: periodo, profissional, clinica, procedimento,
// convenio, status, CID, faixa etaria, genero, fonte.
// ---------------------------------------------------------------------------

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
