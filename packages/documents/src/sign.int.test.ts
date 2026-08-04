import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7, canonicalBytes } from '@cadencia/kernel';
import { createFakeSignatureProvider } from '@cadencia/integrations';
import { signSubject, pendingSignatures } from './sign';
import { semearDocumentos, type SementeDoc } from './test-support';

let s: SementeDoc; let actor: Actor;
const PAYLOAD = canonicalBytes({ schema: 'teste', v: 1 });

beforeAll(async () => {
  s = await semearDocumentos();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('assinatura de um objeto canonico', () => {
  it('assina, verifica e persiste PKCS#7, carimbo e LTV', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider(),
      subjectKind: 'document', subjectId: s.documentId,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estado).toBe('assinado');

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      standard: string; tem_ts: boolean; tem_ltv: boolean }>(
      `SELECT standard, timestamp_token IS NOT NULL AS tem_ts,
              ltv_material_key IS NOT NULL AS tem_ltv
         FROM clin.signature WHERE subject_id = $1`, [s.documentId]));
    expect(rows[0]).toEqual({ standard: 'AD_RT', tem_ts: true, tem_ltv: true });
  });

  it('PSC fora do ar NAO trava o fluxo: cria pendencia e devolve pendente', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider({ modo: 'indisponivel' }),
      subjectKind: 'document', subjectId: s.documentId2,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r).toEqual({ ok: true, value: { estado: 'pendente', motivo: 'unavailable' } });
  });

  it('timeout tambem vira pendencia — e NUNCA retry automatico', async () => {
    const r = await withTenantTx(actor, (tx) => signSubject(tx, {
      provider: createFakeSignatureProvider({ modo: 'timeout' }),
      subjectKind: 'document', subjectId: s.documentId3,
      canonicalPayload: PAYLOAD, signerRef: 'signer-1', signerCpf: '00000000000',
      clinicId: s.clinicId,
    }));
    expect(r).toEqual({ ok: true, value: { estado: 'pendente', motivo: 'timeout' } });
  });

  it('a fila de pendencias alimenta o painel Precisa de voce', async () => {
    const r = await withTenantTx(actor, (tx) => pendingSignatures(tx, s.clinicId));
    expect(r.map((p) => p.subjectId).sort())
      .toEqual([s.documentId2, s.documentId3].sort());
  });
});
