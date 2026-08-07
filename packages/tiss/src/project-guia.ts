// packages/tiss/src/project-guia.ts
import type { Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Resultado de sucesso
// ---------------------------------------------------------------------------

/** Guia projetada com sucesso (completa ou incompleta). */
export interface ProjectedResult {
  readonly kind: 'projected';
  readonly guiaId: string;
  readonly numeroGuia: string;
  readonly status: 'completa' | 'incompleta';
}

/** Atendimento particular — nenhuma guia projetada. */
export interface SkippedResult {
  readonly kind: 'skipped';
}

export type ProjectionResult = ProjectedResult | SkippedResult;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Dados obrigatorios da guia ausentes. A guia FOI criada com status incompleta. */
export interface DadosAusentesError {
  readonly kind: 'dados_obrigatorios_ausentes';
  readonly guiaId: string;
  readonly missingFields: readonly string[];
}

/** Procedimento nao existe na TUSS vigente na data do atendimento. */
export interface TussNaoVigenteError {
  readonly kind: 'tuss_nao_vigente';
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly dataAtendimento: string;
}

export type ProjectionError = DadosAusentesError | TussNaoVigenteError;

// ---------------------------------------------------------------------------
// Assinatura — implementacao nas proximas tarefas
// ---------------------------------------------------------------------------

export declare function projectGuiaConsulta(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ProjectionResult, ProjectionError>>;
