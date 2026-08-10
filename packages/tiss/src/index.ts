export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';

export {
  createContrato,
  updateContrato,
  deactivateContrato,
  listContratos,
  type CreateContratoInput,
  type UpdateContratoInput,
  type ContratoRow,
  type ContratoFailure,
} from './contrato';

export {
  createPacienteConvenio,
  updatePacienteConvenio,
  deactivatePacienteConvenio,
  listPacienteConvenios,
  type CreatePacienteConvenioInput,
  type UpdatePacienteConvenioInput,
  type PacienteConvenioRow,
  type PacienteConvenioFailure,
} from './paciente-convenio';

export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';

export { reprojectGuiaOnAmend, type ReprojectAction, type ReprojectError } from './reproject-guia';

export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
export {
  addGuiaToLote, removeGuiaFromLote,
  type AddGuiaInput, type AddedGuia, type AddGuiaFailure, type RemoveGuiaFailure,
} from './lote-guias';
export {
  markLoteReady, markLoteSent, receiveLoteReturn, cancelLote,
  type LoteLifecycleFailure, type LoteReadyResult, type LoteSentResult,
  type LoteReturnedResult, type LoteCancelledResult,
} from './lote-lifecycle';

export type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './serializer/types';

export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
export { serializeLoteSadt, type SerializeLoteSadtResult } from './serializer/serialize-lote-sadt';
export { ufParaCodigoIbge } from './serializer/uf-ibge';
export { gerarXmlDoLote, type XmlDoLote } from './gerar-xml-lote';

export type {
  RecursoGlosaInput,
  ItemRecursoGlosaInput,
  ContratadoRecursoInput,
} from './serializer/types';

export {
  serializeRecursoGlosa,
  type SerializeRecursoGlosaResult,
} from './serializer/serialize-recurso-glosa';

export { computeRecursoGlosaHash } from './serializer/compute-tiss-hash';

export { encodeIso8859, type EncodeResult } from './serializer/encode-iso8859';
export { computeTissHash } from './serializer/compute-tiss-hash';
export { XmlBuilder } from './serializer/xml-builder';

export type { TissSubmissionReceipt, TissTransport } from './transport/types';
export { createTissArquivoTransport, type TissArquivoOptions } from './transport/tiss-arquivo';
export {
  getTransportIds, getTransportFactory, TISS_TRANSPORT_REGISTRY,
  type TransportFactory,
} from './transport/registry';
export {
  createFakeTissArquivoTransport,
  type FakeTissArquivoOptions,
  type FakeTissArquivoTransport,
  type ModoFakeTiss,
  type SubmittedBatch,
} from './transport/tiss-arquivo-fake';
export {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './transport/tiss-soap';

// Recurso de glosa (Fase 5)
export {
  createRecursoGlosa,
  addGlosaToRecurso,
  removeGlosaFromRecurso,
  markRecursoReady,
  submitRecurso,
  resolveRecurso,
  type RecursoStatus,
  type GlosaItemResultado,
  type CreateRecursoGlosaInput,
  type CreateRecursoItemInput,
  type CreateRecursoFailure,
  type CreatedRecurso,
  type AddGlosaFailure,
  type AddedGlosaItem,
  type RemoveGlosaFailure,
  type RemovedGlosaItem,
  type MarkReadyFailure,
  type RecursoReadyResult,
  type SubmitRecursoFailure,
  type RecursoSentResult,
  type RecursoIndeterminadoResult,
  type ResolveRecursoFailure,
  type ResolveRecursoInput,
  type ResolveItemInput,
  type RecursoResolvedResult,
} from './recurso-glosa/index';

// --- Demonstrativo (Fase 5) ---
export {
  parseDemonstrativoXml,
  decodeIso8859,
  type ParsedDemonstrativo,
  type ParsedDemonstrativoCabecalho,
  type ParsedDemonstrativoItem,
  type ParsedDemonstrativoGlosa,
} from './demonstrativo/parse-demonstrativo';

export {
  importDemonstrativo,
  type ImportDemonstrativoInput,
  type ImportDemonstrativoResult,
  type ImportDemonstrativoFailure,
} from './demonstrativo/import-demonstrativo';
