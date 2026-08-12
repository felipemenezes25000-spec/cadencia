import { err, ok, type Result } from '@cadencia/kernel';
import { CANONICAL_VERSION } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import {
  hashCanonicalVersion,
  type AiSnapshot, type DiagnosisSnapshot, type FieldSnapshot, type FindingSnapshot,
  type ObservationSnapshot, type ProcedureSnapshot, type VersionSnapshot,
} from './canonical-version';

export type VersionKind = 'original' | 'retificacao' | 'adendo' | 'transferencia' | 'anulacao';

export interface FinalizeInput {
  readonly encounterId: string;
  readonly fields: readonly FieldSnapshot[];
  readonly diagnoses: readonly DiagnosisSnapshot[];
  readonly observations: readonly ObservationSnapshot[];
  readonly findings: readonly FindingSnapshot[];
  readonly procedures: readonly ProcedureSnapshot[];
  /**
   * NÃO existe `ai` aqui de propósito.
   *
   * O registro de assistência por IA é escrito durante o atendimento e vive em
   * `clin.ai_assistance`; a finalização apenas o reivindica. Aceitar a lista de
   * quem chama daria ao cliente o poder de decidir o que entra no hash de um
   * documento que a assinatura qualificada assina — e, na prática, só servia
   * para divergir do que o banco realmente sela.
   */
  readonly incompleto?: boolean;
}

export interface AmendInput extends FinalizeInput {
  readonly kind: Exclude<VersionKind, 'original'>;
  readonly supersedesVersionId: string | null;
  readonly justificativa: string | null;
}

export type FinalizeFailure =
  | { kind: 'atendimento_nao_encontrado' }
  | { kind: 'atendimento_nao_esta_em_rascunho' }
  | { kind: 'justificativa_curta' }
  | { kind: 'supersedes_obrigatorio' }
  | { kind: 'supersedes_de_outro_atendimento' }
  | { kind: 'adendo_nao_supera' }
  | { kind: 'cadastro_preliminar_bloqueia_finalizacao'; faltando: readonly string[] };

interface Cabecalho {
  tenant_id: string; patient_id: string; professional_id: string; clinic_id: string;
  occurred_at: string; occurred_date: string; status: string; version_count: number;
  cadastro_status: string; birth_date: string | null;
}

async function lerCabecalho(tx: TxClient, encounterId: string): Promise<Cabecalho | undefined> {
  const { rows } = await tx.query<Cabecalho>(
    `SELECT e.tenant_id, e.patient_id, e.professional_id, e.clinic_id,
            to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
            e.occurred_date::text AS occurred_date, e.status::text AS status, e.version_count,
            p.cadastro_status, p.birth_date::text AS birth_date
       FROM clin.encounter e
       JOIN clin.patient p ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
      WHERE e.id = $1`, [encounterId]);
  return rows[0];
}

function montarPayloadSql(i: FinalizeInput): string {
  return JSON.stringify({
    fields: i.fields.map((f) => ({
      field_id: f.fieldId, field_generation: f.fieldGeneration, label: f.labelSnapshot,
      display_snapshot: f.displaySnapshot, terminology_version: f.terminologyVersion,
      section_instance: f.sectionInstance, ordinal: f.ordinal,
      value_text: f.value.slot === 'value_text' ? f.value.text : null,
      value_num: f.value.slot === 'value_num' ? f.value.num : null,
      value_bool: f.value.slot === 'value_bool' ? f.value.bool : null,
      value_date: f.value.slot === 'value_date' ? f.value.date : null,
      value_ts: f.value.slot === 'value_ts' ? f.value.ts : null,
      // A chave é OMITIDA quando o slot não é value_json — `undefined` some no
      // JSON.stringify. Os outros slots podem ir como null porque a função os lê
      // com `->>`, que devolve SQL NULL para JSON null; value_json é lido com
      // `->`, que devolveria o jsonb 'null' — não-nulo para num_nonnulls, e a
      // linha morreria no CHECK de exatamente um valor preenchido (0034).
      value_json: f.value.slot === 'value_json' ? f.value.json : undefined,
      value_ref_source: f.value.slot === 'value_ref_code' ? f.value.source : null,
      value_ref_code: f.value.slot === 'value_ref_code' ? f.value.code : null,
    })),
    diagnoses: i.diagnoses.map((d) => ({
      code_system: d.codeSystem, code: d.code, display_snapshot: d.displaySnapshot,
      terminology_version: d.terminologyVersion, is_principal: d.isPrincipal })),
    observations: i.observations.map((o) => ({
      observation_code: o.observationCode, value_num: o.valueNum, unit: o.unit,
      component_ordinal: o.componentOrdinal,
      field_id: o.fieldId })),
    findings: i.findings.map((f) => ({
      field_code: f.fieldCode, option_code: f.optionCode,
      display_snapshot: f.displaySnapshot, ordinal: f.ordinal })),
    procedures: i.procedures.map((p) => ({
      code_system: p.codeSystem, tabela: p.tabela, code: p.code,
      display_snapshot: p.displaySnapshot, terminology_version: p.terminologyVersion,
      quantidade: p.quantidade, valor_centavos: p.valorCentavos })),
  });
}

async function selar(
  tx: TxClient, i: FinalizeInput, kind: VersionKind,
  supersedes: string | null, justificativa: string | null,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  const cab = await lerCabecalho(tx, i.encounterId);
  if (!cab) return err({ kind: 'atendimento_nao_encontrado' });
  if (kind === 'original' && cab.status !== 'rascunho') {
    return err({ kind: 'atendimento_nao_esta_em_rascunho' });
  }

  // §5.5 — a dívida de dados do cadastro preliminar é cobrada AQUI, que é o
  // momento em que os dados são de fato obrigatórios. Exigir na hora errada é o
  // que faz a recepcionista digitar 000.000.000-00.
  if (kind === 'original') {
    const faltando: string[] = [];
    if (cab.cadastro_status !== 'completo') faltando.push('cadastro_status');
    if (cab.birth_date === null) faltando.push('birth_date');
    if (faltando.length > 0) {
      return err({ kind: 'cadastro_preliminar_bloqueia_finalizacao', faltando });
    }
  }

  /**
   * A versão superada tem de ser DESTE atendimento.
   *
   * `clin.finalize_encounter` apaga o bit `live` de diagnosis, observation,
   * finding e procedure filtrando só por `version_id` — não confere o
   * `encounter_id`. Sem esta guarda, uma anulação aberta no atendimento A que
   * aponte `supersedesVersionId` para a versão vigente do atendimento B faz o
   * registro de B sumir da leitura, sem que uma linha de B tenha sido tocada e
   * com o status 'anulado' gravado em A. Os ids de versão de todos os
   * atendimentos do paciente saem na leitura do prontuário, então o valor
   * necessário está a um passo de quem tem acesso legítimo.
   */
  if (supersedes !== null) {
    const sup = await tx.query<{ encounter_id: string }>(
      `SELECT encounter_id FROM clin.encounter_version WHERE id = $1`, [supersedes]);
    if (sup.rows[0]?.encounter_id !== i.encounterId) {
      return err({ kind: 'supersedes_de_outro_atendimento' });
    }
  }

  /**
   * As linhas de IA do hash são as que o banco vai selar, não as que o cliente
   * mandou.
   *
   * `clin.finalize_encounter` reivindica toda `clin.ai_assistance` do
   * atendimento que ainda está com `version_id IS NULL` — essas linhas nascem
   * durante a consulta, na rota de transcrição, e o cliente nem as conhece: o
   * front manda `ai: []` sempre. Fazer o hash sobre o array do cliente selava
   * `[]` enquanto a verificação re-derivava as linhas reais, então
   * `verifyVersionHash` acusava adulteração em TODO atendimento que usou IA —
   * um alarme de integridade disparando em prontuário íntegro, que é a maneira
   * mais rápida de ensinar todo mundo a ignorar o alarme.
   *
   * A projeção é idêntica a de `verifyVersionHash` de propósito: as duas pontas
   * do hash têm de ler a mesma coisa da mesma forma.
   */
  const aiASelar = await tx.query<AiSnapshot>(
    `SELECT provider, model_id AS "modelId", model_version AS "modelVersion", purpose,
            risk_class AS "riskClass", residency,
            encode(input_hash,'hex') AS "inputHash", encode(output_hash,'hex') AS "outputHash",
            clinician_decision::text AS "clinicianDecision"
       FROM clin.ai_assistance
      WHERE encounter_id = $1 AND version_id IS NULL`, [i.encounterId]);

  const snapshot: VersionSnapshot = {
    encounterId: i.encounterId,
    patientId: cab.patient_id,
    professionalId: cab.professional_id,
    clinicId: cab.clinic_id,
    occurredAt: cab.occurred_at,
    occurredDate: cab.occurred_date,
    versionNo: cab.version_count + 1,
    kind,
    supersedesVersionId: supersedes,
    justificativa,
    authorUserId: '',            // preenchido abaixo pelo banco, ver comentário
    authorProfessionalId: cab.professional_id,
    cosignerProfessionalId: null,
    incompleto: i.incompleto ?? false,
    fields: i.fields, diagnoses: i.diagnoses, observations: i.observations,
    findings: i.findings, procedures: i.procedures, ai: aiASelar.rows,
  };

  // author_user_id vem do GUC dentro da transação: é a mesma fonte que a função
  // do banco usa, e por isso a re-derivação em verifyVersionHash bate.
  const quem = await tx.query<{ uid: string; pid: string }>(
    `SELECT app.current_user_id()::text AS uid, app.current_professional_id()::text AS pid`);
  const comAutor: VersionSnapshot = {
    ...snapshot,
    authorUserId: quem.rows[0]?.uid ?? '',
    authorProfessionalId: quem.rows[0]?.pid ?? cab.professional_id,
  };

  const hash = hashCanonicalVersion(comAutor);
  const { rows } = await tx.query<{ version_id: string; version_no: number }>(
    `SELECT * FROM clin.finalize_encounter($1, $2::clin.version_kind, $3::jsonb,
              $4::bytea, $5, $6::uuid, $7, $8)`,
    [i.encounterId, kind, montarPayloadSql(i), hash, CANONICAL_VERSION,
     supersedes, justificativa, i.incompleto ?? false]);
  const linha = rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  return ok({ versionId: linha.version_id, versionNo: linha.version_no });
}

export function finalizeEncounter(
  tx: TxClient, i: FinalizeInput,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  return selar(tx, i, 'original', null, null);
}

export async function amendEncounter(
  tx: TxClient, i: AmendInput,
): Promise<Result<{ versionId: string; versionNo: number }, FinalizeFailure>> {
  if (i.kind === 'adendo') {
    // Adendo é bloco ADICIONAL, nunca substituto: não supera ninguém, e por isso
    // o head_version_id não se move. É o que impede o hemograma que chegou dois
    // dias depois de sumir da tela na consulta seguinte.
    if (i.supersedesVersionId !== null) return err({ kind: 'adendo_nao_supera' });
    return selar(tx, i, 'adendo', null, i.justificativa);
  }
  if (i.supersedesVersionId === null) return err({ kind: 'supersedes_obrigatorio' });
  if ((i.justificativa ?? '').trim().length < 10) return err({ kind: 'justificativa_curta' });
  return selar(tx, i, i.kind, i.supersedesVersionId, i.justificativa);
}

/**
 * Re-deriva o payload canônico das linhas SELADAS e compara com o content_hash
 * persistido. É a contraparte da decisão de não calcular o hash no banco:
 * conteúdo imutável + re-derivação = hash errado detectável para sempre.
 */
export async function verifyVersionHash(
  tx: TxClient, versionId: string,
): Promise<Result<{ versionId: string; match: boolean }, FinalizeFailure>> {
  const v = await tx.query<{
    encounter_id: string; version_no: number; kind: string;
    supersedes_version_id: string | null; justificativa: string | null;
    author_user_id: string; author_professional_id: string;
    cosigner_professional_id: string | null; incompleto: boolean;
    content_hash: Buffer; patient_id: string; professional_id: string; clinic_id: string;
    occurred_at: string; occurred_date: string;
  }>(
    `SELECT v.encounter_id, v.version_no, v.kind::text AS kind, v.supersedes_version_id,
            v.justificativa, v.author_user_id, v.author_professional_id,
            v.cosigner_professional_id, v.incompleto, v.content_hash,
            e.patient_id, e.professional_id, e.clinic_id,
            to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
            e.occurred_date::text AS occurred_date
       FROM clin.encounter_version v
       JOIN clin.encounter e ON (e.tenant_id, e.id) = (v.tenant_id, v.encounter_id)
      WHERE v.id = $1`, [versionId]);
  const linha = v.rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });

  const fields = await tx.query<{
    field_id: string; field_generation: number; label_snapshot: string;
    display_snapshot: string | null; terminology_version: string | null;
    section_instance: number; ordinal: number;
    value_text: string | null; value_num: string | null; value_bool: boolean | null;
    value_date: string | null; value_ts: string | null; value_json: unknown;
    value_ref_source: string | null; value_ref_code: string | null;
  }>(
    `SELECT field_id, field_generation, label_snapshot, display_snapshot, terminology_version,
            section_instance, ordinal, value_text, value_num::text AS value_num, value_bool,
            value_date::text AS value_date,
            to_char(value_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS value_ts,
            value_json, value_ref_source, value_ref_code
       FROM clin.encounter_field_value WHERE version_id = $1`, [versionId]);

  const diag = await tx.query<DiagnosisSnapshotRow>(
    `SELECT code_system AS "codeSystem", code, display_snapshot AS "displaySnapshot",
            terminology_version AS "terminologyVersion", is_principal AS "isPrincipal"
       FROM clin.diagnosis WHERE version_id = $1`, [versionId]);
  const obs = await tx.query<ObservationSnapshotRow>(
    `SELECT observation_code AS "observationCode", value_num::text AS "valueNum", unit,
            component_ordinal AS "componentOrdinal"
       FROM clin.observation WHERE version_id = $1`, [versionId]);
  const find = await tx.query<FindingSnapshotRow>(
    `SELECT field_code AS "fieldCode", option_code AS "optionCode",
            display_snapshot AS "displaySnapshot", ordinal
       FROM clin.encounter_finding WHERE version_id = $1`, [versionId]);
  const proc = await tx.query<ProcedureSnapshotRow>(
    `SELECT code_system AS "codeSystem", tabela, code, display_snapshot AS "displaySnapshot",
            terminology_version AS "terminologyVersion", quantidade,
            valor_centavos::int AS "valorCentavos"
       FROM clin.procedure WHERE version_id = $1`, [versionId]);
  const ai = await tx.query<AiSnapshotRow>(
    `SELECT provider, model_id AS "modelId", model_version AS "modelVersion", purpose,
            risk_class AS "riskClass", residency,
            encode(input_hash,'hex') AS "inputHash", encode(output_hash,'hex') AS "outputHash",
            clinician_decision::text AS "clinicianDecision"
       FROM clin.ai_assistance WHERE version_id = $1`, [versionId]);

  const snapshot: VersionSnapshot = {
    encounterId: linha.encounter_id,
    patientId: linha.patient_id,
    professionalId: linha.professional_id,
    clinicId: linha.clinic_id,
    occurredAt: linha.occurred_at,
    occurredDate: linha.occurred_date,
    versionNo: linha.version_no,
    kind: linha.kind,
    supersedesVersionId: linha.supersedes_version_id,
    justificativa: linha.justificativa,
    authorUserId: linha.author_user_id,
    authorProfessionalId: linha.author_professional_id,
    cosignerProfessionalId: linha.cosigner_professional_id,
    incompleto: linha.incompleto,
    fields: fields.rows.map((f) => ({
      fieldId: f.field_id, fieldGeneration: f.field_generation,
      labelSnapshot: f.label_snapshot, displaySnapshot: f.display_snapshot,
      terminologyVersion: f.terminology_version,
      sectionInstance: f.section_instance, ordinal: f.ordinal,
      value:
        f.value_text !== null ? { slot: 'value_text', text: f.value_text } as const :
        f.value_num !== null ? { slot: 'value_num', num: f.value_num } as const :
        f.value_bool !== null ? { slot: 'value_bool', bool: f.value_bool } as const :
        f.value_date !== null ? { slot: 'value_date', date: f.value_date } as const :
        f.value_ts !== null ? { slot: 'value_ts', ts: f.value_ts } as const :
        f.value_ref_code !== null
          ? { slot: 'value_ref_code', source: f.value_ref_source ?? '', code: f.value_ref_code } as const
          : { slot: 'value_json', json: f.value_json as never } as const,
    })),
    diagnoses: diag.rows, observations: obs.rows, findings: find.rows,
    procedures: proc.rows, ai: ai.rows,
  };

  const recalculado = hashCanonicalVersion(snapshot);
  return ok({ versionId, match: recalculado.equals(linha.content_hash) });
}

type DiagnosisSnapshotRow = DiagnosisSnapshot;
type ObservationSnapshotRow = ObservationSnapshot;
type FindingSnapshotRow = FindingSnapshot;
type ProcedureSnapshotRow = ProcedureSnapshot;
type AiSnapshotRow = AiSnapshot;
