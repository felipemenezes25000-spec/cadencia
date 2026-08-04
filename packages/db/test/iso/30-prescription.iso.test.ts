import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('clin.prescription', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });
  afterAll(async () => { await admin.end(); });

  it('persiste do NOSSO lado id, link, codigo, PDF e os bytes assinados', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='prescription'
          AND column_name IN ('provider','provider_prescription_id','patient_link_url',
                              'validation_code','pdf_key','pdf_sha256','signature_id')
        ORDER BY column_name`);
    expect(rows.map((r) => r.column_name)).toEqual([
      'patient_link_url', 'pdf_key', 'pdf_sha256', 'provider',
      'provider_prescription_id', 'signature_id', 'validation_code']);
  });

  it('os itens sao NORMALIZADOS em tabela propria, nao um blob do parceiro', async () => {
    const { rows } = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='clin' AND table_name='prescription_item'`);
    expect(rows[0]?.table_name).toBe('prescription_item');
  });

  it('o id do parceiro e unico por tenant — evento JS repetido nao duplica', async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ux_prescription_provider'`);
    expect(rows[0]?.indexname).toBe('ux_prescription_provider');
  });

  it('e append-only e tem policy RESTRICTIVE', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='prescription' AND NOT p.polpermissive`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    const erro = await (async () => {
      try { await admin.query(`DELETE FROM clin.prescription`); return null; }
      catch (e) { return (e as Error).message; }
    })();
    expect(erro).toMatch(/append-only/);
  });
});
