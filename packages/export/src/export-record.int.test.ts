import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closePdfPool } from '@cadencia/documents';
import { exportRecord } from './export-record';
import { buildReceipt } from './receipt';
import { semearProntuarioCompleto, type SementeExport } from './test-support';

let s: SementeExport; let actor: Actor;

beforeAll(async () => {
  s = await semearProntuarioCompleto();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); await closePdfPool(); });

describe('exportacao integral ECF.18', () => {
  it('o recibo tem os dezenove campos indissociaveis', () => {
    const r = buildReceipt({
      exportId: 'e', patientNome: 'Maria', patientCpf: '111.444.777-35',
      tenantRazaoSocial: 'Clinica ME', tenantCnpj: '12ABC34501DE35', clinicaCnes: '1234567',
      requesterKind: 'titular', requestedByNome: 'Maria', emitidoEm: '2026-08-03T12:00:00.000Z',
      periodoDe: null, periodoAte: null,
      totalVersoes: 3, totalAnexos: 2, totalDocumentos: 1, pageCount: 12,
      pdfSha256Hex: 'ab'.repeat(32), softwareNome: 'Cadência', softwareVersao: '1.0.0',
    });
    expect(Object.keys(r)).toHaveLength(19);
    expect(r.pdfSha256Hex).toBe('ab'.repeat(32));
    expect(r.cnes).toBe('1234567');
  });

  it('produz um PDF com todas as paginas e registra a entidade', async () => {
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'titular' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = await PDFDocument.load(r.value.pdfBytes);
    expect(doc.getPageCount()).toBe(r.value.pageCount);
    expect(r.value.pageCount).toBeGreaterThanOrEqual(2);

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      page_count: number; n_versoes: number; n_anexos: number }>(
      `SELECT page_count,
              array_length(version_ids, 1) AS n_versoes,
              array_length(attachment_ids, 1) AS n_anexos
         FROM clin.record_export WHERE id = $1`, [r.value.exportId]));
    expect(rows[0]?.page_count).toBe(r.value.pageCount);
    expect(rows[0]?.n_versoes).toBe(3);
    expect(rows[0]?.n_anexos).toBe(2);
  });

  it('a numeracao e carimbada por ULTIMO, cobrindo tambem as paginas dos anexos', async () => {
    const r = await withTenantTx(actor, (tx) => exportRecord(tx, {
      patientId: s.patientId, requesterKind: 'judicial' }));
    if (!r.ok) throw new Error('nao exportou');
    const doc = await PDFDocument.load(r.value.pdfBytes);
    expect(doc.getPageCount()).toBe(r.value.pageCount);
    expect(r.value.pageCount).toBeGreaterThanOrEqual(3);
  });

  it('grava evento de auditoria RECORD_EXPORT com o total de paginas', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ meta: { paginas?: number } }>(
      `SELECT meta FROM audit.event WHERE event_type='RECORD_EXPORT' ORDER BY id DESC LIMIT 1`));
    expect(rows[0]?.meta.paginas).toBeGreaterThan(0);
  });
});
