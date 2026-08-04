import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { autoFinalizeStaleDrafts } from './auto-finalize-drafts';
import { semearRascunhoAntigo, type SementeWorker } from '../test-support';

let s: SementeWorker;
beforeAll(async () => { s = await semearRascunhoAntigo(); });
afterAll(async () => { await closePools(); });

describe('auto-finalizacao de rascunho orfao', () => {
  it('finaliza o rascunho parado ha mais de 7 dias, marcado como incompleto', async () => {
    const r = await autoFinalizeStaleDrafts({ limiteDias: 7 });
    expect(r.finalizados).toBeGreaterThanOrEqual(1);

    const { rows } = await jobsPool().query<{ status: string; incompleto: boolean; kind: string }>(
      `SELECT e.status::text AS status, v.incompleto, v.kind::text AS kind
         FROM clin.encounter e JOIN clin.encounter_version v ON v.encounter_id = e.id
        WHERE e.id = $1`, [s.encounterId]);
    expect(rows[0]).toEqual({ status: 'finalizado', incompleto: true, kind: 'original' });
  });

  it('nao toca em rascunho recente', async () => {
    const { rows } = await jobsPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM clin.encounter_draft WHERE encounter_id = $1`,
      [s.encounterRecenteId]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('grava evento de auditoria da auto-finalizacao', async () => {
    const { rows } = await jobsPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('roda tenant a tenant DENTRO de withTenantTx, nunca com BYPASSRLS ligado', async () => {
    const { rows } = await jobsPool().query<{ actor_kind: string }>(
      `SELECT actor_kind FROM audit.event
        WHERE event_type = 'ENCOUNTER_FINALIZE' AND entity_id = $1`, [s.encounterId]);
    expect(rows[0]?.actor_kind).toBe('system');
  });
});
