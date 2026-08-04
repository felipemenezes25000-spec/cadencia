import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('clin.signature', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });
  afterAll(async () => { await admin.end(); });

  it('so aceita AD_RT e AD_RA — AD_RB nao existe no CHECK', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.signature'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%standard%'`);
    expect(rows[0]?.def).toContain('AD_RT');
    expect(rows[0]?.def).toContain('AD_RA');
    expect(rows[0]?.def).not.toContain('AD_RB');
  });

  it('timestamp_token e NOT NULL — carimbo de ACT nao e opcional', async () => {
    const { rows } = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='signature' AND column_name='timestamp_token'`);
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('guarda os bytes canonicos, o PKCS#7 e o material LTV', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='signature'
          AND column_name IN ('canonical_key','canonical_version','pkcs7','ltv_material_key')
        ORDER BY column_name`);
    expect(rows.map((r) => r.column_name))
      .toEqual(['canonical_key', 'canonical_version', 'ltv_material_key', 'pkcs7']);
  });

  it('e append-only: nem UPDATE de conteudo nem DELETE', async () => {
    try {
      await admin.query(`DELETE FROM clin.signature`);
      throw new Error('esperava erro de append-only');
    } catch (e) {
      expect((e as Error).message).toMatch(/append-only/);
    }
  });

  it('ha indice para o job trimestral de re-carimbo por expiracao', async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ix_signature_expira'`);
    expect(rows[0]?.indexname).toBe('ix_signature_expira');
  });
});
