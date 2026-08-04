import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter, amendEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  const base = { fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [] };
  const v1 = await withTenantTx(actor, (tx) =>
    finalizeEncounter(tx, { encounterId: s.encounterId, ...base }));
  if (!v1.ok) throw new Error('falhou v1');
  await withTenantTx(actor, (tx) => amendEncounter(tx, {
    encounterId: s.encounterId, kind: 'adendo', supersedesVersionId: null, justificativa: null,
    ...base }));
  await withTenantTx(actor, (tx) => amendEncounter(tx, {
    encounterId: s.encounterId, kind: 'retificacao', supersedesVersionId: v1.value.versionId,
    justificativa: 'digitado no paciente errado durante a consulta', ...base }));
});
afterAll(async () => { await closePools(); });

describe('o registro vigente e um CONJUNTO', () => {
  it('v_version_status marca v1 como superada e aponta por quem', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      version_no: number; superseded: boolean }>(
      `SELECT version_no, superseded FROM clin.v_version_status
        WHERE encounter_id = $1 ORDER BY version_no`, [s.encounterId]));
    expect(rows).toEqual([
      { version_no: 1, superseded: true },
      { version_no: 2, superseded: false },
      { version_no: 3, superseded: false },
    ]);
  });

  it('read_encounter devolve as NAO superadas — o adendo continua na tela', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      version_no: number; kind: string }>(
      `SELECT version_no, kind::text AS kind FROM clin.read_encounter($1) ORDER BY version_no`,
      [s.encounterId]));
    expect(rows).toEqual([
      { version_no: 2, kind: 'adendo' },
      { version_no: 3, kind: 'retificacao' },
    ]);
  });

  it('a leitura clinica gera evento de auditoria deduplicado por 5 minutos', async () => {
    await withTenantTx(actor, (tx) => tx.query(`SELECT * FROM clin.read_encounter($1)`,
      [s.encounterId]));
    await withTenantTx(actor, (tx) => tx.query(`SELECT * FROM clin.read_encounter($1)`,
      [s.encounterId]));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'PATIENT_RECORD_READ' AND entity_id = $1`, [s.patientId]));
    // Tres chamadas, uma janela: UM evento.
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('read_patient_record devolve a linha do tempo com data do EVENTO, nao do registro', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      encounter_id: string; occurred_date: string; versoes_vivas: number }>(
      `SELECT encounter_id, occurred_date::text AS occurred_date, versoes_vivas
         FROM clin.read_patient_record($1) ORDER BY occurred_date DESC`, [s.patientId]));
    expect(rows.some((r) => r.encounter_id === s.encounterId && r.versoes_vivas === 2)).toBe(true);
  });
});
