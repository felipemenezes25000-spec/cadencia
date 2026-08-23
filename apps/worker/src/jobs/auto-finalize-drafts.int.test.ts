import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { canonicalHash, CANONICAL_VERSION } from '@cadencia/kernel';
import { InMemoryStorageAdapter } from '@cadencia/storage';
import { autoFinalizeStaleDrafts } from './auto-finalize-drafts';
import { semearRascunhoAntigo, type SementeWorker } from '../test-support';

let s: SementeWorker;
const storage = new InMemoryStorageAdapter();

beforeAll(async () => { s = await semearRascunhoAntigo(); });
afterAll(async () => { await closePools(); });

describe('auto-finalizacao de rascunho orfao', () => {
  it('finaliza o rascunho parado ha mais de 7 dias, marcado como incompleto', async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 }, storage);
    expect(r.finalizados).toBeGreaterThanOrEqual(1);

    const { rows } = await jobsPool().query<{ status: string; incompleto: boolean; kind: string }>(
      `SELECT e.status::text AS status, v.incompleto, v.kind::text AS kind
         FROM clin.encounter e JOIN clin.encounter_version v ON v.encounter_id = e.id
        WHERE e.id = $1`, [s.encounterId]);
    expect(rows[0]).toEqual({ status: 'finalizado', incompleto: true, kind: 'original' });
  });

  it('preserva o payload bruto como anexo imutavel e hashado', async () => {
    const { rows } = await jobsPool().query<{
      id: string; storage_key: string; original_name: string; content_type: string;
      sha256: Buffer; version_id: string | null;
    }>(
      `SELECT id, storage_key::text, original_name, content_type, sha256, version_id
         FROM clin.attachment
        WHERE encounter_id = $1 AND original_name = 'rascunho-clinico-recuperado.json'`,
      [s.encounterId]);

    const anexo = rows[0];
    expect(anexo).toBeDefined();
    expect(anexo?.content_type).toBe('application/json');
    expect(anexo?.version_id).not.toBeNull();

    const bytes = await storage.get(`anexos/${anexo!.storage_key}`);
    expect(bytes).not.toBeNull();
    const buffer = Buffer.from(bytes!);
    expect(JSON.parse(buffer.toString('utf8'))).toEqual({ queixa: 'dor' });
    expect(anexo!.sha256.toString('hex')).toBe(
      createHash('sha256').update(buffer).digest('hex'),
    );
  });

  it('grava content_hash que rederiva do contrato canonico da versao incompleta', async () => {
    const { rows } = await jobsPool().query<{
      encounter_id: string; patient_id: string; professional_id: string; clinic_id: string;
      occurred_at: string; occurred_date: string; version_no: number; kind: string;
      author_user_id: string; author_professional_id: string; incompleto: boolean;
      content_hash: Buffer;
    }>(
      `SELECT e.id AS encounter_id, e.patient_id, e.professional_id, e.clinic_id,
              to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
              e.occurred_date::text AS occurred_date,
              v.version_no, v.kind::text AS kind,
              v.author_user_id::text, v.author_professional_id::text,
              v.incompleto, v.content_hash
         FROM clin.encounter e
         JOIN clin.encounter_version v ON (v.tenant_id, v.encounter_id) = (e.tenant_id, e.id)
        WHERE e.id = $1`,
      [s.encounterId]);
    const x = rows[0]!;

    const esperado = canonicalHash({
      schema: 'cadencia.encounter_version',
      canonicalVersion: CANONICAL_VERSION,
      encounterId: x.encounter_id,
      patientId: x.patient_id,
      professionalId: x.professional_id,
      clinicId: x.clinic_id,
      occurredAt: x.occurred_at,
      occurredDate: x.occurred_date,
      versionNo: x.version_no,
      kind: x.kind,
      supersedesVersionId: null,
      justificativa: null,
      authorUserId: x.author_user_id,
      authorProfessionalId: x.author_professional_id,
      cosignerProfessionalId: null,
      incompleto: x.incompleto,
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
    });

    expect(x.content_hash.toString('hex')).toBe(esperado.toString('hex'));
  });

  it('nao toca em rascunho recente', async () => {
    const { rows } = await jobsPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM clin.encounter_draft WHERE encounter_id = $1`,
      [s.encounterRecenteId]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('grava evento de auditoria da auto-finalizacao e do snapshot recuperado', async () => {
    const { rows } = await jobsPool().query<{ event_type: string }>(
      `SELECT ev.event_type
         FROM audit.event ev
        WHERE (ev.event_type = 'ENCOUNTER_FINALIZE' AND ev.entity_id = $1)
           OR (ev.event_type = 'STALE_DRAFT_ARCHIVED' AND ev.entity_id IN (
                 SELECT a.id FROM clin.attachment a WHERE a.encounter_id = $1))`,
      [s.encounterId]);
    expect(rows.some((x) => x.event_type === 'ENCOUNTER_FINALIZE')).toBe(true);
    expect(rows.some((x) => x.event_type === 'STALE_DRAFT_ARCHIVED')).toBe(true);
  });

  it('roda tenant a tenant DENTRO de withTenantTx, nunca com BYPASSRLS ligado', async () => {
    const { rows } = await jobsPool().query<{ actor_kind: string }>(
      `SELECT actor_kind FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]);
    expect(rows[0]?.actor_kind).toBe('system');
  });
});
