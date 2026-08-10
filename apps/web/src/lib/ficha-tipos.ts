/**
 * A forma da configuracao de prontuario, como o backend a devolve.
 *
 * Mora em `lib` e nao junto do componente porque quem monta o payload clinico e
 * um transformador puro: fazer ele importar de um `.tsx` acopla regra de dado a
 * arvore de React — e o typecheck da raiz, que nao compila JSX, reprova.
 */

export interface ComponenteDoCampo {
  readonly ordinal: number;
  readonly label: string;
  readonly unit: string | null;
  readonly observationCode: string;
}

export interface CampoDaFicha {
  readonly fieldId: string;
  readonly code: string;
  readonly label: string;
  readonly kind: string;
  readonly generation: number;
  readonly required: boolean;
  readonly unit: string | null;
  readonly options: readonly string[] | null;
  readonly refSource: string | null;
  /** Presente quando o campo promove para `clin.observation` (peso, altura). */
  readonly observationCode: string | null;
  readonly componentes: readonly ComponenteDoCampo[];
}

export interface SecaoDaFicha {
  readonly sectionId: string;
  readonly code: string;
  readonly label: string;
  readonly campos: readonly CampoDaFicha[];
}
