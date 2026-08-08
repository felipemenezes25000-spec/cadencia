// packages/tiss/src/recurso-glosa/types.ts

/**
 * Tipos do dominio de recurso de glosa TISS.
 *
 * O recurso de glosa e a contestacao formal do prestador contra glosas
 * aplicadas pela operadora em um demonstrativo de retorno. O ciclo de vida e:
 * rascunho -> pronto -> enviado -> (deferido | indeferido | parcial)
 * Com desvio para 'indeterminado' em caso de timeout no envio (§7 design).
 */

export type RecursoStatus =
  | 'rascunho'
  | 'pronto'
  | 'enviado'
  | 'indeterminado'
  | 'deferido'
  | 'indeferido'
  | 'parcial';

export type GlosaItemResultado = 'deferido' | 'indeferido';

export interface CreateRecursoGlosaInput {
  readonly operadoraId: string;
  readonly createdBy: string;
  readonly itens: readonly CreateRecursoItemInput[];
}

export interface CreateRecursoItemInput {
  readonly glosaId: string;
  readonly justificativa: string;
  readonly valorRecursadoCents: number;
}

export type CreateRecursoFailure =
  | { kind: 'sem_itens' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'glosa_nao_encontrada'; glosaId: string }
  | { kind: 'glosa_nao_pendente'; glosaId: string; status: string }
  | { kind: 'glosa_operadora_divergente'; glosaId: string };

export interface CreatedRecurso {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type AddGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'glosa_nao_encontrada' }
  | { kind: 'glosa_nao_pendente'; status: string }
  | { kind: 'glosa_operadora_divergente' }
  | { kind: 'glosa_ja_no_recurso' };

export interface AddedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type RemoveGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface RemovedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type MarkReadyFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'sem_itens' }
  | { kind: 'justificativa_geral_ausente' };

export interface RecursoReadyResult {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type SubmitRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'transport_indisponivel'; detail: string }
  | { kind: 'transport_rejeitado'; detail: string }
  | { kind: 'transport_nao_suportado'; detail: string }
  | { kind: 'transport_indeterminado'; detail: string };

export interface RecursoSentResult {
  readonly recursoId: string;
  readonly protocoloOperadora?: string;
  readonly storageKey?: string;
}

export interface RecursoIndeterminadoResult {
  readonly recursoId: string;
  readonly detail: string;
}

export type ResolveRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'item_nao_encontrado'; glosaId: string };

export interface ResolveRecursoInput {
  readonly resultado: 'deferido' | 'indeferido' | 'parcial';
  readonly itensResolvidos: readonly ResolveItemInput[];
}

export interface ResolveItemInput {
  readonly glosaId: string;
  readonly resultado: GlosaItemResultado;
}

export interface RecursoResolvedResult {
  readonly recursoId: string;
  readonly resultado: string;
  readonly itensDeferidos: number;
  readonly itensIndeferidos: number;
}
