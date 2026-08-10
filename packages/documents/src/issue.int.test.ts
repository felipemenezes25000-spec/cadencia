import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createFakeSignatureProvider } from '@cadencia/integrations';
import { issueDocument, buildDocumentCanonical } from './issue';
import { semearDocumentos, type SementeDoc } from './test-support';

let s: SementeDoc; let actor: Actor;

beforeAll(async () => {
  s = await semearDocumentos();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('emissao de documento', () => {
  it('o canonico do atestado carrega paciente, profissional, clinica e o texto', () => {
    const p = buildDocumentCanonical({
      kind: 'atestado', patientId: 'p', professionalId: 'pr', clinicId: 'c',
      issuedDate: '2026-08-03',
      payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2, cid: null },
    });
    expect(p.schema).toBe('cadencia.document');
    expect(p.kind).toBe('atestado');
    expect(JSON.stringify(p)).toContain('Atesto para os devidos fins');
  });

  it('emite o atestado ja assinado e ligado a versao do atendimento', async () => {
    const r = await withTenantTx(actor, (tx) => issueDocument(tx, {
      provider: createFakeSignatureProvider(),
      kind: 'atestado', patientId: s.patientId, professionalId: s.professionalId,
      clinicId: s.clinicId, encounterId: s.encounterId, versionId: s.versionId,
      issuedDate: '2026-08-03', signerRef: 'signer-1', signerCpf: '00000000000',
      payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2, cid: null },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assinatura.estado).toBe('assinado');

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      kind: string; tem_assinatura: boolean }>(
      `SELECT kind::text AS kind, signature_id IS NOT NULL AS tem_assinatura
         FROM clin.document WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [s.patientId]));
    expect(rows[0]).toEqual({ kind: 'atestado', tem_assinatura: true });
  });

  it('PSC fora do ar emite o documento assim mesmo, com a pendencia registrada', async () => {
    const r = await withTenantTx(actor, (tx) => issueDocument(tx, {
      provider: createFakeSignatureProvider({ modo: 'indisponivel' }),
      kind: 'pedido_exame', patientId: s.patientId, professionalId: s.professionalId,
      clinicId: s.clinicId, issuedDate: '2026-08-03',
      signerRef: 'signer-1', signerCpf: '00000000000',
      payload: { itens: ['Hemograma completo', 'TSH'] },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assinatura).toEqual({ estado: 'pendente', motivo: 'unavailable' });
  });

  it('grava evento de auditoria DOCUMENT_ISSUE sem o texto do documento', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ meta: unknown }>(
      `SELECT meta FROM audit.event WHERE event_type='DOCUMENT_ISSUE' ORDER BY id DESC LIMIT 1`));
    expect(JSON.stringify(rows[0]?.meta)).not.toContain('Atesto');
  });
});

describe('emissao sem PSC contratado', () => {
  it('emite o documento e o deixa PENDENTE, sem forjar assinatura', async () => {
    const { createUncontractedSignatureProvider } = await import('@cadencia/integrations');
    const r = await withTenantTx(actor, (tx) => issueDocument(tx, {
      provider: createUncontractedSignatureProvider(),
      kind: 'atestado', patientId: s.patientId, professionalId: s.professionalId,
      clinicId: s.clinicId, encounterId: s.encounterId, versionId: s.versionId,
      issuedDate: '2026-08-04', signerRef: 'signer-1', signerCpf: '00000000000',
      payload: { texto: 'Atesto sem PSC contratado', diasAfastamento: 1, cid: null },
    }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // O documento EXISTE e esta no prontuario: nao emitir seria pior, porque o
    // atendimento aconteceu. O que nao pode e sair com carimbo que nao existe.
    expect(r.value.documentId).toBeTruthy();
    expect(r.value.assinatura.estado).toBe('pendente');

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      motivo: string; signature_id: string | null; resolved_at: string | null }>(
      `SELECT motivo, signature_id, resolved_at FROM clin.signature_pending
        WHERE subject_id = $1`, [r.value.documentId]));

    // A pendencia fica registrada com o motivo. Quando o PSC for contratado, a
    // fila e assinada sem reemitir documento nenhum — e por isso o canonico e o
    // hash ja foram gravados agora.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.motivo).toBe('rejected');
    expect(rows[0]?.signature_id).toBeNull();
    expect(rows[0]?.resolved_at).toBeNull();

    const { rows: doc } = await withTenantTx(actor, (tx) => tx.query<{
      signature_id: string | null }>(
      `SELECT signature_id FROM clin.document WHERE id = $1`, [r.value.documentId]));
    expect(doc[0]?.signature_id).toBeNull();
  });
});
