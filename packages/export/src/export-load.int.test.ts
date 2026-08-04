import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closePdfPool } from '@cadencia/documents';
import { exportRecord } from './export-record';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

const NOTURNO = process.env['CADENCIA_LOAD_TESTS'] === '1';

let s: SementeExport; let actor: Actor;

describe.skipIf(!NOTURNO)('exportacao sob carga — Apendice A: p95 < 60 s', () => {
  beforeAll(async () => {
    s = await semearProntuarioCompleto();
    actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
              requestId: uuidv7() };
    const url = process.env['DATABASE_URL_ADMIN'];
    if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
    const admin = new Pool({ connectionString: url, max: 1 });
    const c = await admin.connect();
    try {
      for (let ano = 2006; ano <= 2025; ano += 1) {
        for (let mes = 1; mes <= 12; mes += 1) {
          const encId = uuidv7();
          const dia = `${ano}-${String(mes).padStart(2, '0')}-15`;
          await c.query(
            `INSERT INTO clin.encounter
               (tenant_id, id, patient_id, professional_id, clinic_id,
                occurred_at, occurred_date, status)
             VALUES ($1, $2, $3, $4, $5, ($6::date)::timestamptz, $6::date, 'finalizado')`,
            [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId, dia]);
          const verId = uuidv7();
          await c.query(
            `INSERT INTO clin.encounter_version
               (tenant_id, id, encounter_id, version_no, kind, author_user_id,
                author_professional_id, finalized_at, content_hash, serializer_version)
             VALUES ($1, $2, $3, 1, 'original', $4, $5, ($6::date)::timestamptz,
                     decode(repeat('11',32),'hex'), 'jcs-1')`,
            [s.tenantId, verId, encId, s.userId, s.professionalId, dia]);
          await c.query(
            `INSERT INTO clin.encounter_field_value
               (tenant_id, id, version_id, finalized_at, field_id, field_generation,
                label_snapshot, ordinal, value_text)
             VALUES ($1, gen_random_uuid(), $2, ($3::date)::timestamptz, $4, 1,
                     'Queixa principal', 0, 'consulta de rotina sem intercorrencias')`,
            [s.tenantId, verId, dia, s.fieldId]);
        }
      }
      for (let n = 0; n < 500; n += 1) {
        await c.query(
          `INSERT INTO clin.attachment
             (tenant_id, id, patient_id, kind, storage_key, original_name, content_type,
              size_bytes, sha256, dek_ref, occurred_date, created_by)
           VALUES ($1, gen_random_uuid(), $2, 'resultado_exame', gen_random_uuid(),
                   $3, 'application/pdf', 120000, decode(repeat('22',32),'hex'),
                   'dek-teste', '2020-01-15', $4)`,
          [s.tenantId, s.patientId, `exame-${n}.pdf`, s.userId]);
      }
      await c.query(`ANALYZE clin.encounter`);
      await c.query(`ANALYZE clin.encounter_field_value`);
    } finally {
      c.release();
      await admin.end();
    }
  }, 900_000);

  afterAll(async () => { await closePools(); await closePdfPool(); });

  it('exporta 20 anos com 500 anexos em menos de 60 s, sem estouro de memoria', async () => {
    const antes = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'judicial', blocosPorLote: 20 }));
    const ms = Date.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(60_000);
    const depois = process.memoryUsage().heapUsed;
    expect(depois - antes).toBeLessThan(600 * 1024 * 1024);
  }, 180_000);

  it('a exportacao registra a duracao medida, para o painel de latencia', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ duration_ms: number }>(
      `SELECT duration_ms FROM clin.record_export ORDER BY created_at DESC LIMIT 1`));
    expect(rows[0]?.duration_ms).toBeGreaterThan(0);
    expect(rows[0]?.duration_ms).toBeLessThan(60_000);
  });
});
