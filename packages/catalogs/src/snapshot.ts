import type { ResolvedTerm } from './cid10';

/**
 * As quatro colunas que TODA gravação de código carrega, em
 * clin.encounter_field_value e nas tabelas de primeira classe (§3.5, §3.6):
 * o valor órfão sobrevive, o significado não. Gravar só o código faz o
 * prontuário de 2027, impresso em 2035, mostrar a descrição de 2035.
 */
export interface TermSnapshot {
  value_ref_source: 'CID10';
  value_ref_code: string;
  display_snapshot: string;
  terminology_version: string;
}

export function toTermSnapshot(resolved: ResolvedTerm): TermSnapshot {
  return {
    value_ref_source: resolved.system,
    value_ref_code: resolved.code,
    display_snapshot: resolved.display,
    terminology_version: resolved.terminologyVersion,
  };
}
