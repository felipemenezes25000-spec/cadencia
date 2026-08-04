import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('clin.attachment', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });
  afterAll(async () => { await admin.end(); });

  it('a chave de objeto e UUID opaco e o nome original mora no BANCO', async () => {
    const { rows } = await admin.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='attachment'
          AND column_name IN ('storage_key','original_name') ORDER BY column_name`);
    expect(rows).toEqual([
      { column_name: 'original_name', data_type: 'text' },
      { column_name: 'storage_key', data_type: 'uuid' },
    ]);
  });

  it('guarda a referencia da chave de dados — base do crypto-shredding', async () => {
    const { rows } = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='attachment' AND column_name='dek_ref'`);
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('classifica o anexo — resultado de exame alimenta o painel Precisa de voce', async () => {
    const { rows } = await admin.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname='clin' AND t.typname='attachment_kind' ORDER BY e.enumsortorder`);
    expect(rows.map((r) => r.label)).toEqual([
      'resultado_exame', 'imagem', 'documento_externo', 'consentimento', 'outro']);
  });

  it('tem policy RESTRICTIVE — carrega patient_id', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='attachment' AND NOT p.polpermissive`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
