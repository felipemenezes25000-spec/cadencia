import { jobsPool, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, canonicalHash, CANONICAL_VERSION } from '@cadencia/kernel';

export interface AutoFinalizeResult {
  readonly examinados: number;
  readonly finalizados: number;
  readonly falhas: number;
}

export async function autoFinalizeStaleDrafts(
  opts: { limiteDias?: number } = {},
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
    try {
      let fez = false;
      await withTenantTx(ator, async (tx) => {
        const rascunho = await tx.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM clin.encounter_draft WHERE encounter_id = $1`,
          [linha.encounter_id]);
        const cab = await tx.query<{
          patient_id: string; clinic_id: string; occurred_at: string; occurred_date: string }>(
          `SELECT patient_id, clinic_id,
                  to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
                  occurred_date::text AS occurred_date
             FROM clin.encounter WHERE id = $1`, [linha.encounter_id]);
        const c = cab.rows[0];
        if (!c) return;

        const hash = canonicalHash({
          schema: 'cadencia.encounter_version',
          canonicalVersion: CANONICAL_VERSION,
          encounterId: linha.encounter_id,
          patientId: c.patient_id, professionalId: linha.professional_id,
          clinicId: c.clinic_id, occurredAt: c.occurred_at, occurredDate: c.occurred_date,
          versionNo: 1, kind: 'original', supersedesVersionId: null, justificativa: null,
          authorUserId: '', authorProfessionalId: linha.professional_id,
          cosignerProfessionalId: null, incompleto: true,
          fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
          rascunho: JSON.stringify(rascunho.rows[0]?.payload ?? {}),
        });

        await tx.query(
          `SELECT clin.finalize_encounter($1, 'original', $2::jsonb, $3::bytea, $4,
                    NULL, NULL, true)`,
          [linha.encounter_id, JSON.stringify({ fields: [] }), hash, CANONICAL_VERSION]);
        fez = true;
      });
      if (fez) finalizados += 1;
    } catch {
      falhas += 1;
    }
  }

  return { examinados: rows.length, finalizados, falhas };
}
