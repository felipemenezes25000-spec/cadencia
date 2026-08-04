import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { collectRecord } from './collect';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

let s: SementeExport; let actor: Actor;

beforeAll(async () => {
  s = await semearProntuarioCompleto();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('coleta do prontuario integral', () => {
  it('ordena pela data do EVENTO, nao pela do registro', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const datas = r.blocos.map((b) => b.occurredDate);
    expect([...datas]).toEqual([...datas].sort());
  });

  it('inclui TODAS as versoes, inclusive as superadas — nada some da exportacao', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const versoes = r.blocos.flatMap((b) => b.versoes);
    expect(versoes.some((v) => v.superseded)).toBe(true);
    expect(versoes).toHaveLength(3);
  });

  it('marca a versao superada para ser TACHADA na renderizacao', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const superada = r.blocos.flatMap((b) => b.versoes).find((v) => v.superseded);
    expect(superada?.tachado).toBe(true);
    expect(superada?.justificativaDaSuperssao).toContain('paciente errado');
  });

  it('traz anexos e documentos referenciados pelo bloco a que pertencem', async () => {
    const r = await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    expect(r.anexos).toHaveLength(2);
    expect(r.documentos).toHaveLength(1);
    expect(r.anexos[0]?.storageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeita o recorte por periodo quando ele existe', async () => {
    const r = await withTenantTx(actor, (tx) =>
      collectRecord(tx, { patientId: s.patientId, from: '2026-06-01', to: '2026-06-30' }));
    expect(r.blocos).toHaveLength(1);
  });

  it('a coleta e leitura clinica e gera evento de auditoria', async () => {
    await withTenantTx(actor, (tx) => collectRecord(tx, { patientId: s.patientId }));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'PATIENT_RECORD_READ' AND entity_id = $1`, [s.patientId]));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
