import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter, amendEncounter, verifyVersionHash } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente;
let actor: Actor;
let v1 = '';

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
    encounterId: s.encounterId,
    fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Queixa principal',
               displaySnapshot: null, terminologyVersion: null, sectionInstance: 1, ordinal: 0,
               value: { slot: 'value_text', text: 'cefaleia ha 3 dias' } }],
    diagnoses: [{ codeSystem: 'CID10', code: 'J45', displaySnapshot: 'Asma',
                  terminologyVersion: '2026-01', isPrincipal: true }],
    observations: [], findings: [], procedures: [], ai: [],
  }));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  v1 = r.value.versionId;
});
afterAll(async () => { await closePools(); });

describe('retificacao, adendo e o conjunto vigente', () => {
  it('o hash persistido bate com o re-derivado das linhas seladas', async () => {
    const r = await withTenantTx(actor, (tx) => verifyVersionHash(tx, v1));
    expect(r).toEqual({ ok: true, value: { versionId: v1, match: true } });
  });

  it('retificacao exige justificativa de 10 caracteres', async () => {
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1,
      justificativa: 'errado',
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'justificativa_curta' } });
  });

  it('retificacao apaga o bit live das filhas superadas, e so delas', async () => {
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1,
      justificativa: 'digitado no paciente errado durante a consulta',
      fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Queixa principal',
                 displaySnapshot: null, terminologyVersion: null, sectionInstance: 1, ordinal: 0,
                 value: { slot: 'value_text', text: 'cefaleia ha 3 dias, sem febre' } }],
      diagnoses: [{ codeSystem: 'CID10', code: 'I10', displaySnapshot: 'Hipertensao essencial',
                    terminologyVersion: '2026-01', isPrincipal: true }],
      observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r.ok).toBe(true);

    const cids = await withTenantTx(actor, (tx) => tx.query<{ code: string; live: boolean }>(
      `SELECT code, live FROM clin.diagnosis WHERE encounter_id = $1 ORDER BY code`,
      [s.encounterId]));
    // J45 e retificado para I10: sem o bit live, os DOIS apareceriam no relatorio.
    expect(cids.rows).toEqual([{ code: 'I10', live: true }, { code: 'J45', live: false }]);
  });

  it('adendo NAO supera ninguem e NAO move o head_version_id', async () => {
    const antes = await withTenantTx(actor, (tx) => tx.query<{ head: string }>(
      `SELECT head_version_id AS head FROM clin.encounter WHERE id = $1`, [s.encounterId]));
    const r = await withTenantTx(actor, (tx) => amendEncounter(tx, {
      encounterId: s.encounterId, kind: 'adendo', supersedesVersionId: null, justificativa: null,
      fields: [{ fieldId: s.fieldQueixaId, fieldGeneration: 1, labelSnapshot: 'Hemograma',
                 displaySnapshot: null, terminologyVersion: null, sectionInstance: 2, ordinal: 0,
                 value: { slot: 'value_text', text: 'Hb 13,2 — chegou dois dias depois' } }],
      diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
    }));
    expect(r.ok).toBe(true);
    const depois = await withTenantTx(actor, (tx) => tx.query<{ head: string; n: number }>(
      `SELECT head_version_id AS head, version_count AS n FROM clin.encounter WHERE id = $1`,
      [s.encounterId]));
    expect(depois.rows[0]?.head).toBe(antes.rows[0]?.head);
    expect(depois.rows[0]?.n).toBe(3);
  });
});
