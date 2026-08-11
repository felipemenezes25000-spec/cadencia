// packages/catalogs/src/index.ts
export { resolveTussAt, type ResolvedTussTerm, type TussFailure } from './tuss';
export { loadTussCompetenciaSafe, type TussLoadInput, type TussLoadResult } from './tuss-load';
export {
  resolveCid10At, parseCid10Csv, loadCid10Competencia,
  type ResolvedTerm, type Cid10Failure,
} from './cid10';
export {
  resolveCid11At, loadCid11Release, entidadesDaLinearizacao,
  type EntidadeIcd11, type ResolvedCid11, type Cid11Failure,
} from './cid11';
export { exigeOauth } from './icd-endpoint';
