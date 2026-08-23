import { createHash } from 'node:crypto';
import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, canonicalHash, CANONICAL_VERSION } from '@cadencia/kernel';
import { createStorageAdapterFromEnv, type StorageAdapter } from '@cadencia/storage';

export interface AutoFinalizeResult {
  readonly examinados: number;
  readonly finalizados: number;
  readonly falhas: number;
}

interface AiPendente {
  provider: string;
  model_id: string;
  model_version: string;
  purpose: string;
  risk_class: string;
  residency: string;
  input_hash: Buffer;
  output_hash: Buffer;
  clinician_decision: string;
}

function ordenarAi(itens: readonly AiPendente[]): Array<{
  provider: string; modelId: string; modelVersion: string; purpose: string;
  riskClass: string; residency: string; inputHash: string; outputHash: string;
  clinicianDecision: string;
}> {
  return itens.map((a) => ({
    provider: a.provider,
    modelId: a.model_id,
    modelVersion: a.model_version,
    purpose: a.purpose,
    riskClass: a.risk_class,
    residency: a.residency,
    inputHash: a.input_hash.toString('hex'),
    outputHash: a.output_hash.toString('hex'),
    clinicianDecision: a.clinician_decision,
  })).sort((a, b) => {
    const ka = `${a.provider}|${a.modelId}|${a.outputHash}`;
    const kb = `${b.provider}|${b.modelId}|${b.outputHash}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Rascunho órfão precisa ser fechado como INCOMPLETO, nunca reinterpretado como
 * registro clínico estruturado sem um profissional presente para confirmar a
 * semântica. O conteúdo bruto, porém, não pode desaparecer: ele é preservado
 * como anexo JSON imutável e hashado do próprio atendimento.
 */
export async function autoFinalizeStaleDrafts(
  opts: { limiteDias?: number } = {},
  storage: StorageAdapter = createStorageAdapterFromEnv(),
): Promise<AutoFinalizeResult> {
  const limite = opts.limiteDias ?? 7;
  const { rows } = await jobsPool().query<{
    tenant_id: string; encounter_id: string; professional_id: string; clinic_id: string }>(
    `SELECT tenant_id, encounter_id, professional_id, clinic_id
       FROM clin.stale_drafts(make_interval(days => $1))`, [limite]);

  let finalizados = 0;
  let falhas = 0;

  for (const linha of rows) {
    const ator: Actor = {
      kind: 'system', tenantId: linha.tenant_id,
      reason: 'auto-finalize-stale-draft', requestId: uuidv7(),
    };
    let objetoCriado: string | null = null;

    try {
      let fez = false;
      await withTenantTx(ator, async (tx) => {
        const rascunho = await tx.query<{
          payload: Record<string, unknown>; updated_by: string;
        }>(
          `SELECT payload, updated_by FROM clin.encounter_draft WHERE encounter_id = $1`,
          [linha.encounter_id]);
        const draft = rascunho.rows[0];
        if (draft === undefined) return;

        const cab = await tx.query<{
          patient_id: string; professional_id: string; clinic_id: string;
          occurred_at: string; occurred_date: string; version_count: number;
          author_user_id: string;
        }>(
          `SELECT e.patient_id, e.professional_id, e.clinic_id,
                  to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
                  e.occurred_date::text AS occurred_date,
                  e.version_count,
                  p.user_id::text AS author_user_id
             FROM clin.encounter e
             JOIN app.professional p
               ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
            WHERE e.id = $1`, [linha.encounter_id]);
        const c = cab.rows[0];
        if (!c) return;

        const ai = await tx.query<AiPendente>(
          `SELECT provider, model_id, model_version, purpose, risk_class, residency,
                  input_hash, output_hash, clinician_decision::text AS clinician_decision
             FROM clin.ai_assistance
            WHERE encounter_id = $1 AND version_id IS NULL`,
          [linha.encounter_id]);

        // Este objeto é EXATAMENTE o contrato de buildCanonicalVersion para uma
        // versão incompleta sem campos confirmados. O código antigo acrescentava
        // `rascunho` ao hash e usava authorUserId vazio; a verificação posterior
        // rederivava outro objeto e acusava adulteração em dado íntegro.
        const hash = canonicalHash({
          schema: 'cadencia.encounter_version',
          canonicalVersion: CANONICAL_VERSION,
          encounterId: linha.encounter_id,
          patientId: c.patient_id,
          professionalId: c.professional_id,
          clinicId: c.clinic_id,
          occurredAt: c.occurred_at,
          occurredDate: c.occurred_date,
          versionNo: c.version_count + 1,
          kind: 'original',
          supersedesVersionId: null,
          justificativa: null,
          authorUserId: c.author_user_id,
          authorProfessionalId: c.professional_id,
          cosignerProfessionalId: null,
          incompleto: true,
          fields: [],
          diagnoses: [],
          observations: [],
          findings: [],
          procedures: [],
          ai: ordenarAi(ai.rows),
        });

        const bytes = Buffer.from(JSON.stringify(draft.payload), 'utf8');
        const storageKey = uuidv7();
        const attachmentId = uuidv7();
        const sha256 = createHash('sha256').update(bytes).digest();
        objetoCriado = `anexos/${storageKey}`;

        // O objeto vai primeiro. Se S3 falhar, o prontuário continua rascunho e
        // nada é perdido. Se o SQL falhar depois, o catch remove o objeto órfão.
        await storage.put(objetoCriado, bytes, 'application/json');

        const fechado = await tx.query<{ version_id: string; version_no: number }>(
          `SELECT * FROM clin.finalize_encounter($1, 'original', $2::jsonb, $3::bytea, $4,
                    NULL, NULL, true)`,
          [
            linha.encounter_id,
            JSON.stringify({ fields: [], diagnoses: [], observations: [], findings: [], procedures: [] }),
            hash,
            CANONICAL_VERSION,
          ]);
        const versao = fechado.rows[0];
        if (versao === undefined) throw new Error('auto_finalizacao_sem_versao');

        await tx.query(
          `INSERT INTO clin.attachment
             (id, patient_id, encounter_id, version_id, kind, storage_key,
              original_name, content_type, size_bytes, sha256, dek_ref,
              occurred_date, created_by)
           VALUES ($1,$2,$3,$4,'outro',$5,$6,'application/json',$7,$8,$9,$10,$11)`,
          [
            attachmentId,
            c.patient_id,
            linha.encounter_id,
            versao.version_id,
            storageKey,
            'rascunho-clinico-recuperado.json',
            bytes.length,
            sha256,
            process.env['STORAGE_KMS_KEY_ID'] ?? 'sem-kms',
            c.occurred_date,
            draft.updated_by,
          ],
        );

        // A trilha não recebe conteúdo. As duas chaves usadas são da whitelist
        // de audit.meta_keys_ok; adicionar `version_id` aqui faria a própria
        // proteção anti-PII recusar a transação.
        await tx.query(
          `SELECT audit.log('STALE_DRAFT_ARCHIVED', 'clin', 'attachment', $1,
                  'sucesso', jsonb_build_object(
                    'job_name', 'auto-finalize-stale-draft',
                    'kind', 'snapshot_recuperado'), $2)`,
          [attachmentId, c.clinic_id]);

        fez = true;
      });
      if (fez) {
        objetoCriado = null; // agora o objeto tem linha transacional correspondente
        finalizados += 1;
      }
    } catch {
      if (objetoCriado !== null) {
        await storage.delete(objetoCriado).catch(() => undefined);
      }
      falhas += 1;
    }
  }

  return { examinados: rows.length, finalizados, falhas };
}
