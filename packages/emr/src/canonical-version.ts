import { CANONICAL_VERSION, canonicalHash, type JsonValue } from '@cadencia/kernel';

/**
 * §4.3 e §10 item 6 — o objeto canonico que o content_hash cobre e que a
 * assinatura ICP-Brasil assina. E o contrato mais permanente do sistema.
 *
 * COBRE: patient_id, professional_id, clinic_id, occurred_at, occurred_date,
 *        TODOS os valores de campo, os codigos materializados e o ai_assistance
 *        (modelo, versao, hash da saida, decisao do medico).
 * NAO COBRE: live, head_version_id, version_count — os tres sao bit de indice e
 *        cache de leitura, e mudam depois da selagem por design.
 *
 * Numeros vem como STRING de proposito. A regra de serializacao numerica do
 * ECMAScript, que a RFC 8785 herda, nao representa `numeric` do PostgreSQL sem
 * perda: 0.1 + 0.2, 1e21 e o arredondamento de 17 digitos significativos sao
 * todos armadilhas reais. Peso "70.50" e "70.5" sao valores diferentes na tela e
 * precisam ser hashes diferentes.
 */

export type FieldValue =
  | { readonly slot: 'value_text'; readonly text: string }
  | { readonly slot: 'value_num'; readonly num: string }
  | { readonly slot: 'value_bool'; readonly bool: boolean }
  | { readonly slot: 'value_date'; readonly date: string }
  | { readonly slot: 'value_ts'; readonly ts: string }
  | { readonly slot: 'value_json'; readonly json: JsonValue }
  | { readonly slot: 'value_ref_code'; readonly source: string; readonly code: string };

export interface FieldSnapshot {
  readonly fieldId: string;
  readonly fieldGeneration: number;
  readonly labelSnapshot: string;
  readonly displaySnapshot: string | null;
  readonly terminologyVersion: string | null;
  readonly sectionInstance: number;
  readonly ordinal: number;
  readonly value: FieldValue;
}

export interface DiagnosisSnapshot {
  readonly codeSystem: string; readonly code: string;
  readonly displaySnapshot: string; readonly terminologyVersion: string;
  readonly isPrincipal: boolean;
}

export interface ObservationSnapshot {
  readonly observationCode: string; readonly valueNum: string;
  readonly unit: string | null; readonly componentOrdinal: number;
}

export interface FindingSnapshot {
  readonly fieldCode: string; readonly optionCode: string;
  readonly displaySnapshot: string; readonly ordinal: number;
}

export interface ProcedureSnapshot {
  readonly codeSystem: string; readonly tabela: number | null; readonly code: string;
  readonly displaySnapshot: string; readonly terminologyVersion: string | null;
  readonly quantidade: number; readonly valorCentavos: number;
}

export interface AiSnapshot {
  readonly provider: string; readonly modelId: string; readonly modelVersion: string;
  readonly purpose: string; readonly riskClass: string; readonly residency: string;
  readonly inputHash: string; readonly outputHash: string;
  readonly clinicianDecision: string;
}

export interface VersionSnapshot {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly clinicId: string;
  readonly occurredAt: string;       // RFC 3339 UTC com milissegundos
  readonly occurredDate: string;     // AAAA-MM-DD no fuso da clinica
  readonly versionNo: number;
  readonly kind: string;
  readonly supersedesVersionId: string | null;
  readonly justificativa: string | null;
  readonly authorUserId: string;
  readonly authorProfessionalId: string;
  readonly cosignerProfessionalId: string | null;
  readonly incompleto: boolean;
  readonly fields: readonly FieldSnapshot[];
  readonly diagnoses: readonly DiagnosisSnapshot[];
  readonly observations: readonly ObservationSnapshot[];
  readonly findings: readonly FindingSnapshot[];
  readonly procedures: readonly ProcedureSnapshot[];
  readonly ai: readonly AiSnapshot[];
}

/** Ordem total e deterministica, independente da ordem em que o banco devolveu. */
function porChave<T>(itens: readonly T[], chave: (t: T) => string): T[] {
  return [...itens].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
}

function valorCanonico(v: FieldValue): JsonValue {
  switch (v.slot) {
    case 'value_text': return { slot: v.slot, text: v.text };
    case 'value_num': return { slot: v.slot, num: v.num };
    case 'value_bool': return { slot: v.slot, bool: v.bool };
    case 'value_date': return { slot: v.slot, date: v.date };
    case 'value_ts': return { slot: v.slot, ts: v.ts };
    case 'value_json': return { slot: v.slot, json: v.json };
    case 'value_ref_code': return { slot: v.slot, source: v.source, code: v.code };
  }
}

export function buildCanonicalVersion(s: VersionSnapshot): JsonValue & { schema: string; canonicalVersion: string } {
  return {
    schema: 'cadencia.encounter_version',
    canonicalVersion: CANONICAL_VERSION,
    encounterId: s.encounterId,
    patientId: s.patientId,
    professionalId: s.professionalId,
    clinicId: s.clinicId,
    occurredAt: s.occurredAt,
    occurredDate: s.occurredDate,
    versionNo: s.versionNo,
    kind: s.kind,
    supersedesVersionId: s.supersedesVersionId,
    justificativa: s.justificativa,
    authorUserId: s.authorUserId,
    authorProfessionalId: s.authorProfessionalId,
    cosignerProfessionalId: s.cosignerProfessionalId,
    incompleto: s.incompleto,
    fields: porChave(s.fields, (f) => `${f.fieldId}|${f.sectionInstance}|${f.ordinal}`).map((f) => ({
      fieldId: f.fieldId,
      fieldGeneration: f.fieldGeneration,
      labelSnapshot: f.labelSnapshot,
      displaySnapshot: f.displaySnapshot,
      terminologyVersion: f.terminologyVersion,
      sectionInstance: f.sectionInstance,
      ordinal: f.ordinal,
      value: valorCanonico(f.value),
    })),
    diagnoses: porChave(s.diagnoses, (d) => `${d.codeSystem}|${d.code}`).map((d) => ({
      codeSystem: d.codeSystem, code: d.code,
      displaySnapshot: d.displaySnapshot, terminologyVersion: d.terminologyVersion,
      isPrincipal: d.isPrincipal,
    })),
    observations: porChave(s.observations, (o) => `${o.observationCode}|${o.componentOrdinal}`)
      .map((o) => ({
        observationCode: o.observationCode, valueNum: o.valueNum,
        unit: o.unit, componentOrdinal: o.componentOrdinal,
      })),
    findings: porChave(s.findings, (f) => `${f.fieldCode}|${f.optionCode}|${f.ordinal}`)
      .map((f) => ({
        fieldCode: f.fieldCode, optionCode: f.optionCode,
        displaySnapshot: f.displaySnapshot, ordinal: f.ordinal,
      })),
    procedures: porChave(s.procedures, (p) => `${p.codeSystem}|${p.tabela ?? ''}|${p.code}`)
      .map((p) => ({
        codeSystem: p.codeSystem, tabela: p.tabela, code: p.code,
        displaySnapshot: p.displaySnapshot, terminologyVersion: p.terminologyVersion,
        quantidade: p.quantidade, valorCentavos: p.valorCentavos,
      })),
    ai: porChave(s.ai, (a) => `${a.provider}|${a.modelId}|${a.outputHash}`).map((a) => ({
      provider: a.provider, modelId: a.modelId, modelVersion: a.modelVersion,
      purpose: a.purpose, riskClass: a.riskClass, residency: a.residency,
      inputHash: a.inputHash, outputHash: a.outputHash,
      clinicianDecision: a.clinicianDecision,
    })),
  } as JsonValue & { schema: string; canonicalVersion: string };
}

export function hashCanonicalVersion(s: VersionSnapshot): Buffer {
  return canonicalHash(buildCanonicalVersion(s));
}
