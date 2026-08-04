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
