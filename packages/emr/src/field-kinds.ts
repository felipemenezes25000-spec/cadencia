/**
 * §4.2 — os tipos de campo, o slot de cada um em clin.encounter_field_value e
 * para qual tabela de primeira classe promovem.
 *
 * Este arquivo e o mapa que clin.finalize_encounter usa para explodir o payload.
 * Errar aqui grava numero em value_text e o grafico de peso deixa de existir.
 * A ordem da lista e a da tabela da §4.2 de proposito: o teste compara literal.
 */

export const FIELD_KIND_LIST = [
  'texto_longo', 'texto_curto', 'numerico', 'composto', 'booleano', 'data',
  'lista_unica', 'multipla_escolha', 'busca_tabela', 'imc', 'dpp_ig',
  'curva_crescimento', 'odontograma', 'oculos', 'orcamento',
] as const;

export type FieldKind = (typeof FIELD_KIND_LIST)[number];

/** Colunas de valor de clin.encounter_field_value. `null` = o tipo nao grava valor direto. */
export type ValueSlot =
  | 'value_text' | 'value_num' | 'value_bool' | 'value_date'
  | 'value_ts' | 'value_json' | 'value_ref_code';

/** Tabela de primeira classe para a qual o valor e materializado, se houver. */
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
  // Nucleo narrativo. Suporta #, / e @ inline na tela, mas grava texto puro.
  texto_longo:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  texto_curto:  { slot: 'value_text', promotesTo: null, multiRow: false, derived: false },
  // Promove para clin.observation quando record_field.is_reportable = true.
  numerico:     { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: false },
  // PA -> PA_SIS + PA_DIA. Uma linha de valor por componente, com ordinal proprio.
  composto:     { slot: null,         promotesTo: 'observation', multiRow: true,  derived: false },
  booleano:     { slot: 'value_bool', promotesTo: null, multiRow: false, derived: false },
  data:         { slot: 'value_date', promotesTo: null, multiRow: false, derived: false },
  // Opcao referenciavel e filtravel: vira clin.encounter_finding.
  lista_unica:  { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: false, derived: false },
  // Comorbidades com 4 marcacoes = 4 linhas. Sem isso a clinica nao lista os diabeticos.
  multipla_escolha: { slot: 'value_ref_code', promotesTo: 'encounter_finding', multiRow: true, derived: false },
  // CID-10/TUSS/medicamento: value_ref_code + display_snapshot + terminology_version.
  busca_tabela: { slot: 'value_ref_code', promotesTo: 'coded', multiRow: false, derived: false },
  // Calculados no servidor: cliente nunca manda o resultado, so os insumos.
  imc:          { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  dpp_ig:       { slot: 'value_num',  promotesTo: 'observation', multiRow: false, derived: true },
  // Prosa estruturada: nao e eixo de relatorio que entregamos (§3.6 regra a).
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
