/**
 * ss5.5 fluxo (c) — Engine de atribuicao de variacao de receita.
 *
 * Cada fator e um valor em CENTAVOS (inteiro). A soma dos fatores e
 * EXATAMENTE igual ao delta total: propriedade matematica, nao aproximacao.
 */

/** Periodo definido por [start, end] inclusive. */
export interface Period {
  readonly start: string; // 'YYYY-MM-DD'
  readonly end: string;   // 'YYYY-MM-DD'
}

/**
 * Fatores aditivos que decompoem o delta de receita entre dois periodos.
 * Todos os valores sao em centavos. Positivo = contribuiu para aumento.
 * Negativo = contribuiu para queda. A soma de TODOS os fatores e
 * exatamente igual a delta_total_cents.
 */
export interface VariationFactors {
  /** Efeito volume: mais ou menos atendimentos realizados. */
  readonly volume_cents: number;
  /** Efeito mix de procedimento: mudanca de proporcao entre procedimentos. */
  readonly mix_procedimento_cents: number;
  /** Efeito mix de convenio: mudanca particular vs convenio. */
  readonly mix_convenio_cents: number;
  /** Efeito ticket medio: mudanca de valor medio por atendimento. */
  readonly ticket_cents: number;
  /** Receita perdida por faltas e cancelamentos. */
  readonly faltas_cents: number;
  /** Glosas nao recuperadas (zero enquanto TISS nao existir). */
  readonly glosas_cents: number;
  /** Receita total do periodo A em centavos. */
  readonly total_a_cents: number;
  /** Receita total do periodo B em centavos. */
  readonly total_b_cents: number;
  /** Delta = total_b - total_a. Soma dos fatores = delta_total_cents. */
  readonly delta_total_cents: number;
}

/** Snapshot persistido em rpt.variation_snapshot. */
export interface VariationSnapshot {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly periodA: Period;
  readonly periodB: Period;
  readonly computedAt: string;
  readonly factors: VariationFactors;
}

/** Agrupamento para drill-down de um fator. */
export interface DrillDownGroup {
  readonly label: string;
  readonly count: number;
  readonly amount_cents: number;
}

export interface DrillDownResult {
  readonly factor: string;
  readonly byProfessional: readonly DrillDownGroup[];
  readonly byDayOfWeek: readonly DrillDownGroup[];
  readonly byTimeSlot: readonly DrillDownGroup[];
}

/**
 * Valida que a soma dos fatores e exatamente o delta total.
 * Retorna true se a propriedade matematica se sustenta.
 */
export function factorsAddUp(f: VariationFactors): boolean {
  const soma =
    f.volume_cents +
    f.mix_procedimento_cents +
    f.mix_convenio_cents +
    f.ticket_cents +
    f.faltas_cents +
    f.glosas_cents;
  return soma === f.delta_total_cents;
}
