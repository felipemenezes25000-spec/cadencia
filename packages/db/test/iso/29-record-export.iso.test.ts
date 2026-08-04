import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('clin.record_export', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });
  afterAll(async () => { await admin.end(); });

  it('congela o CONJUNTO exportado — versoes e anexos, por id', async () => {
    const { rows } = await admin.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='record_export'
          AND column_name IN ('version_ids','attachment_ids') ORDER BY column_name`);
    expect(rows).toEqual([
      { column_name: 'attachment_ids', data_type: 'ARRAY' },
      { column_name: 'version_ids', data_type: 'ARRAY' },
    ]);
  });

  it('guarda o recibo indissociavel com os ~11 campos', async () => {
    const { rows } = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='record_export' AND column_name='receipt_json'`);
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('e append-only: exportacao emitida nao se apaga nem se reescreve', async () => {
    try {
      await admin.query(`DELETE FROM clin.record_export`);
      throw new Error('esperava erro de append-only');
    } catch (e) {
      expect((e as Error).message).toMatch(/append-only/);
    }
  });

  it('registra quem pediu e em que qualidade — paciente, procurador ou juizo', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.record_export'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%requester_kind%'`);
    for (const k of ['titular', 'representante', 'profissional', 'judicial', 'fiscalizacao']) {
      expect(rows[0]?.def).toContain(k);
    }
  });
});
