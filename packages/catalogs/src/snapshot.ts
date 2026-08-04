import type { ResolvedTerm } from './cid10';

/**
 * As quatro colunas que TODA gravacao de codigo carrega, em
 * clin.encounter_field_value e nas tabelas de primeira classe (§3.5, §3.6):
 * o valor orfao sobrevive, o significado nao. Gravar so o codigo faz o
 * prontuario de 2027, impresso em 2035, mostrar a descricao de 2035.
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
