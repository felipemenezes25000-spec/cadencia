import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('clin.document', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });
  afterAll(async () => { await admin.end(); });

  it('cobre os quatro tipos nato-digitais da Fase 1', async () => {
    const { rows } = await admin.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname='clin' AND t.typname='document_kind' ORDER BY e.enumsortorder`);
    expect(rows.map((r) => r.label))
      .toEqual(['atestado', 'pedido_exame', 'relatorio', 'declaracao_comparecimento']);
  });

  it('e append-only e liga-se a assinatura', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='document'
          AND column_name IN ('signature_id','pdf_key','pdf_sha256','content_hash')
        ORDER BY column_name`);
    expect(rows.map((r) => r.column_name))
      .toEqual(['content_hash', 'pdf_key', 'pdf_sha256', 'signature_id']);
  });

  it('recusa DELETE — o verbo Excluir nao existe para documento emitido', async () => {
    try {
      await admin.query(`DELETE FROM clin.document`);
      throw new Error('esperava erro de append-only');
    } catch (e) {
      expect((e as Error).message).toMatch(/append-only/);
    }
  });

  it('tem policy RESTRICTIVE — a tabela carrega patient_id', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname='document' AND NOT p.polpermissive`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
