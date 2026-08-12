/**
 * §4.2 — os tipos de campo, o slot de cada um em clin.encounter_field_value e
 * para qual tabela de primeira classe promovem.
 *
 * Este arquivo é o mapa que clin.finalize_encounter usa para explodir o payload.
 * Errar aqui grava número em value_text e o gráfico de peso deixa de existir.
 * A ordem da lista é a da tabela da §4.2 de propósito: o teste compara literal.
 */

export const FIELD_KIND_LIST = [
  'texto_longo', 'texto_curto', 'numerico', 'composto', 'booleano', 'data',
  'lista_unica', 'multipla_escolha', 'busca_tabela', 'imc', 'dpp_ig',
  'curva_crescimento', 'odontograma', 'oculos', 'orcamento',
] as const;

export type FieldKind = (typeof FIELD_KIND_LIST)[number];

/** Colunas de valor de clin.encounter_field_value. `null` = o tipo não grava valor direto. */
export type ValueSlot =
  | 'value_text' | 'value_num' | 'value_bool' | 'value_date'
  | 'value_ts' | 'value_json' | 'value_ref_code';

/** Tabela de primeira classe para a qual o valor é materializado, se houver. */
export type Promotion = 'observation' | 'encounter_finding' | 'coded';

export interface FieldKindDef {
  readonly slot: ValueSlot | null;
  readonly promotesTo: Promotion | null;
  /** Gera N linhas de encounter_field_value (ordinal > 0) em vez de uma. */
  readonly multiRow: boolean;
  /** Calculado no SERVIDOR a partir de outros campos, nunca digitado. */
  readonly derived: boolean;
}

export const FIELD_KINDS: Readonly<Record<FieldKind, FieldKindDef>> = {
  // Núcleo narrativo. Suporta #, / e @ inline na tela, mas grava texto puro.
  texto_longo:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  texto_curto:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  // Promove para clin.observation quando record_field.is_reportable = true.
  numerico:     { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: false },
  // PA -> PA_SIS + PA_DIA. Uma linha de valor por componente, com ordinal próprio.
  composto:     { slot: null,         promotesTo: 'observation', multiRow: true,  derived: false },
  booleano:     { slot: 'value_bool', promotesTo: null, multiRow: false, derived: false },
  data:         { slot: 'value_date', promotesTo: null, multiRow: false, derived: false },
  // Opção referenciável e filtrável: vira clin.encounter_finding.
  lista_unica:  { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: false, derived: false },
  // Comorbidades com 4 marcações = 4 linhas. Sem isso a clínica não lista os diabéticos.
  multipla_escolha: { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: true, derived: false },
  // CID-10/TUSS/medicamento: value_ref_code + display_snapshot + terminology_version.
  busca_tabela: { slot: 'value_ref_code', promotesTo: 'coded', multiRow: false, derived: false },
  // Calculados no servidor: cliente nunca manda o resultado, só os insumos.
  imc:          { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  dpp_ig:       { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  // Prosa estruturada: não é eixo de relatório que entregamos (§3.6 regra a).
  curva_crescimento: { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  odontograma:  { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  oculos:       { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
  orcamento:    { slot: 'value_json', promotesTo: null, multiRow: false, derived: false },
};

export function slotOf(kind: FieldKind): ValueSlot | null {
  return FIELD_KINDS[kind].slot;
}

export function promotesTo(kind: FieldKind): Promotion | null {
  return FIELD_KINDS[kind].promotesTo;
}

export function isMultiRow(kind: FieldKind): boolean {
  return FIELD_KINDS[kind].multiRow;
}

export function isDerived(kind: FieldKind): boolean {
  return FIELD_KINDS[kind].derived;
}
