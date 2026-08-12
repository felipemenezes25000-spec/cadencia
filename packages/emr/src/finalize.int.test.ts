import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearAtendimento, type Semente } from './test-support';
import { finalizeEncounter } from './finalize';

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

const PAYLOAD = {
  fields: [
    { field_id: null as string | null, code: 'queixa', section_instance: 1, ordinal: 0,
      value_text: 'cefaleia ha 3 dias' },
  ],
};

describe('clin.finalize_encounter', () => {
  it('sela a versao 1 como original, com o autor sendo QUEM ESCREVEU', async () => {
    const r = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'original',
            p_payload => $2::jsonb,
            p_content_hash => decode($3, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => NULL,
            p_justificativa => NULL,
            p_incompleto => false)`,
        [s.encounterId, JSON.stringify({
          ...PAYLOAD,
          fields: [{ field_id: s.fieldQueixaId, code: 'queixa', label: 'Queixa principal',
                     field_generation: 1, section_instance: 1, ordinal: 0,
                     value_text: 'cefaleia ha 3 dias' }],
          diagnoses: [{ code_system: 'CID10', code: 'I10',
                        display_snapshot: 'Hipertensao essencial',
                        terminology_version: '2026-01', is_principal: true }],
          observations: [
            { observation_code: 'PA_SIS', value_num: '120', unit: 'mmHg',
              field_id: s.fieldPaId, component_ordinal: 1 },
            { observation_code: 'PA_DIA', value_num: '80', unit: 'mmHg',
              field_id: s.fieldPaId, component_ordinal: 2 }],
          findings: [], procedures: [], ai: [],
        }), '11'.repeat(32)]);
      return rows[0];
    });
    expect(r?.version_no).toBe(1);

    const estado = await withTenantTx(actor, async (tx) => {
      const enc = await tx.query<{ status: string; version_count: number; head: string }>(
        `SELECT status::text AS status, version_count, head_version_id AS head
           FROM clin.encounter WHERE id = $1`, [s.encounterId]);
      const v = await tx.query<{ kind: string; author_professional_id: string }>(
        `SELECT kind::text AS kind, author_professional_id FROM clin.encounter_version
          WHERE encounter_id = $1`, [s.encounterId]);
      const efv = await tx.query<{ label_snapshot: string; value_text: string }>(
        `SELECT label_snapshot, value_text FROM clin.encounter_field_value
          WHERE version_id = $1`, [r?.version_id]);
      const obs = await tx.query<{ observation_code: string; value_num: string }>(
        `SELECT observation_code, value_num FROM clin.observation
          WHERE version_id = $1 ORDER BY component_ordinal`, [r?.version_id]);
      const rascunho = await tx.query(
        `SELECT 1 FROM clin.encounter_draft WHERE encounter_id = $1`, [s.encounterId]);
      return {
        status: enc.rows[0]?.status, count: enc.rows[0]?.version_count,
        head: enc.rows[0]?.head === r?.version_id,
        kind: v.rows[0]?.kind, autor: v.rows[0]?.author_professional_id,
        efv: efv.rows, obs: obs.rows, rascunhoSobrou: rascunho.rowCount,
      };
    });

    expect(estado.status).toBe('finalizado');
    expect(estado.count).toBe(1);
    expect(estado.head).toBe(true);
    expect(estado.kind).toBe('original');
    expect(estado.autor).toBe(s.professionalId);
    expect(estado.efv).toEqual([
      { label_snapshot: 'Queixa principal', value_text: 'cefaleia ha 3 dias' }]);
    expect(estado.obs).toEqual([
      { observation_code: 'PA_SIS', value_num: '120' },
      { observation_code: 'PA_DIA', value_num: '80' }]);
    expect(estado.rascunhoSobrou).toBe(0);
  });

  it('grava evento de auditoria ENCOUNTER_FINALIZE, com entity_id e sem dado clinico', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      event_type: string; entity_table: string; outcome: string; meta: Record<string, unknown> }>(
      `SELECT event_type, entity_table, outcome, meta FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]));
    expect(rows[0]?.entity_table).toBe('encounter_version');
    expect(rows[0]?.outcome).toBe('sucesso');
    expect(JSON.stringify(rows[0]?.meta)).not.toContain('cefaleia');
  });

  it('recusa finalizar duas vezes o mesmo atendimento como original', async () => {
    await expect(
      withTenantTx(actor, (tx) => tx.query(
        `SELECT clin.finalize_encounter($1, 'original', '{}'::jsonb,
                 decode($2,'hex'), 'jcs-1', NULL, NULL, false)`,
        [s.encounterId, '22'.repeat(32)])),
    ).rejects.toThrow(/atendimento nao esta em rascunho/);
  });

  it('recusa content_hash que nao tenha 32 bytes', async () => {
    await expect(
      withTenantTx(actor, (tx) => tx.query(
        `SELECT clin.finalize_encounter($1, 'original', '{}'::jsonb,
                 decode('00','hex'), 'jcs-1', NULL, NULL, false)`, [s.encounterId])),
    ).rejects.toThrow(/32 bytes|violates check constraint/);
  });
});

describe('finalizeEncounter com sinais vitais', () => {
  it('grava a observacao ligada ao CAMPO que a originou', async () => {
    const s2 = await semearAtendimento();
    const actor2: Actor = { kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
                            clinicId: s2.clinicId, requestId: uuidv7() };

    const r = await withTenantTx(actor2, (tx) => finalizeEncounter(tx, {
      encounterId: s2.encounterId,
      fields: [{
        fieldId: s2.fieldQueixaId, fieldGeneration: 1,
        labelSnapshot: 'Queixa principal', displaySnapshot: null,
        terminologyVersion: null, sectionInstance: 1, ordinal: 0,
        value: { slot: 'value_text', text: 'consulta de rotina' },
      }],
      // `clin.observation.field_id` é NOT NULL: a observação existe como
      // PROJEÇÃO de um campo, e sem saber de qual campo veio não dá para
      // reprojetar nem retificar. O contrato não tinha `fieldId` e o código
      // alcançava por cast — resultado: qualquer atendimento com sinal vital
      // falhava com 23502, e o caminho nunca tinha sido exercitado.
      observations: [{
        fieldId: s2.fieldPaId, observationCode: 'PA_SIS',
        valueNum: '120', unit: 'mmHg', componentOrdinal: 1,
      }],
      diagnoses: [], findings: [], procedures: [],
    }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor2, (tx) => tx.query<{
      observation_code: string; value_num: string; field_id: string }>(
      `SELECT observation_code, value_num::text, field_id
         FROM clin.observation WHERE version_id = $1`, [r.value.versionId]));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.observation_code).toBe('PA_SIS');
    expect(rows[0]?.field_id).toBe(s2.fieldPaId);
  });
});
