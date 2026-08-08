// packages/tiss/src/recurso-glosa/index.ts
export { createRecursoGlosa } from './create-recurso';
export { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
export { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
export type {
  RecursoStatus,
  GlosaItemResultado,
  CreateRecursoGlosaInput,
  CreateRecursoItemInput,
  CreateRecursoFailure,
  CreatedRecurso,
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  RecursoIndeterminadoResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  ResolveItemInput,
  RecursoResolvedResult,
} from './types';
