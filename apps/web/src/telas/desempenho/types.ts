// apps/web/src/telas/desempenho/types.ts

/** Indicador exibido como frase clicavel na pagina de entrada /desempenho. */
export interface VariationIndicator {
  /** Chave semantica do indicador. */
  readonly metric: 'receita' | 'ticket_medio' | 'ocupacao';
  /** Delta absoluto em centavos (receita/ticket) ou pontos percentuais (ocupacao). */
  readonly deltaAbsolute: number;
  /** Delta percentual (ex: -18 para queda de 18%). */
  readonly deltaPercent: number;
}

/** Um fator que compoe o waterfall de decomposicao de um indicador. */
export interface WaterfallFactor {
  readonly factorId: string;
  readonly label: string;
  /** Valor em centavos — positivo contribui para aumento, negativo para queda. */
  readonly valueCents: number;
}

/** Agrupamento de drill-down ao clicar em um fator do waterfall. */
export interface DrillDownGroup {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly valueCents: number;
}

/** Linha de drill-down agrupada por dimensao. */
export interface DrillDownResult {
  readonly dimension: 'profissional' | 'dia_semana' | 'faixa_horario';
  readonly groups: readonly DrillDownGroup[];
  /** Contagem total de itens no drill-down. */
  readonly totalCount: number;
}

/** Acao sugerida ao final do drill-down. */
export interface SuggestedAction {
  readonly actionId: string;
  readonly label: string;
  /** Link para a tela de automacoes com parametros pre-preenchidos. */
  readonly href: string;
}

/** Periodo selecionado no formato YYYY-MM. */
export interface Period {
  readonly current: string;
  readonly previous: string;
}

/** Carimbo de atualizacao dos dados vindos de matview. */
export interface DataFreshness {
  readonly source: 'live' | 'matview';
  /** ISO 8601 do momento do ultimo refresh, presente apenas quando source=matview. */
  readonly refreshedAt: string | null;
}

// -- Explorar ----------------------------------------------------------------

export type ChartKind = 'bar' | 'line' | 'pie';

export interface ExploreFilter {
  readonly professionalId?: string;
  readonly clinicId?: string;
  readonly categoryId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly paymentMethod?: string;
  readonly status?: string;
}

export interface ExploreRow {
  readonly key: string;
  readonly label: string;
  readonly valueCents: number;
  readonly count: number;
}

export interface SavedView {
  readonly viewId: string;
  readonly name: string;
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
}

// -- Satisfacao ---------------------------------------------------------------

export interface NpsSummary {
  readonly score: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
  readonly totalResponses: number;
}

export interface NpsPoint {
  readonly period: string;
  readonly score: number;
}

export interface NpsByProfessional {
  readonly professionalId: string;
  readonly professionalName: string;
  readonly score: number;
  readonly responses: number;
}

// -- Exportar -----------------------------------------------------------------

export type ExportFormat = 'csv' | 'xlsx';
