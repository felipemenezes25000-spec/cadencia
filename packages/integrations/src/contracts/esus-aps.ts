import type { ProviderCtx, ProviderResult } from './common';

export type EsusApsRecordKind =
  | 'atendimento_individual'
  | 'atendimento_odontologico'
  | 'procedimento'
  | 'visita_domiciliar'
  | 'cadastro_individual'
  | 'cadastro_domiciliar';

export interface EsusApsRecordInput {
  readonly kind: EsusApsRecordKind;
  readonly patientId: string;
  readonly encounterId?: string;
  readonly cnes: string;
  readonly ine?: string;
  readonly professionalCns: string;
  readonly cbo: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EsusApsExportResult {
  readonly protocol?: string;
  readonly batchId?: string;
}

/** Fronteira e-SUS APS. Não há fake que reporte sucesso: ausência de integração deve ser explícita. */
export interface EsusApsGateway {
  exportRecord(input: EsusApsRecordInput, ctx: ProviderCtx): Promise<ProviderResult<EsusApsExportResult>>;
}
