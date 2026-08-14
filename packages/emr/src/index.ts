export {
  FIELD_KINDS, FIELD_KIND_LIST, slotOf, promotesTo, isMultiRow, isDerived,
  type FieldKind, type FieldKindDef, type Promotion, type ValueSlot,
} from './field-kinds';
export {
  openDraft, saveDraft,
  type DraftFailure, type DraftPayload, type DraftState, type SaveDraftInput,
} from './draft';
export {
  buildCanonicalVersion, hashCanonicalVersion,
  type AiSnapshot, type DiagnosisSnapshot, type FieldSnapshot, type FieldValue,
  type FindingSnapshot, type ObservationSnapshot, type ProcedureSnapshot,
  type VersionSnapshot,
} from './canonical-version';
export {
  finalizeEncounter, amendEncounter, verifyVersionHash,
  type AmendInput, type FinalizeFailure, type FinalizeInput, type VersionKind,
} from './finalize';
export {
  CONDICOES_DA_FACE, CONDICOES_DO_DENTE, DENTES_DECIDUOS, DENTES_PERMANENTES,
  FACES, ODONTOGRAMA_VAZIO,
  ROTULO_DA_CONDICAO_DA_FACE, ROTULO_DA_CONDICAO_DO_DENTE, ROTULO_DA_FACE,
  contarMarcados, dentesDaDenticao, ehAnterior, ehDenteValido,
  escreverOdontograma, lerOdontograma,
  type CondicaoDaFace, type CondicaoDoDente, type Dente, type DenteDeciduo,
  type DentePermanente, type Denticao, type EstadoDoDente, type Face,
  type Odontograma,
} from './odontograma';
