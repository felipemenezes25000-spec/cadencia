import { describe, expect, it } from 'vitest';
import { createFakeSignatureProvider } from './signature-fake';
import { asStorageKey, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'doc-1', deadlineMs: 3000,
};

const doc = {
  documentId: 'doc-1', hashAlgorithm: 'SHA-256' as const,
  hashBase64: Buffer.alloc(32, 7).toString('base64'),
  canonicalPayloadKey: asStorageKey('k'), canonicalVersion: 'jcs-1',
  policy: 'AD_RT_CAdES_2.4' as const, detached: true as const,
};

describe('provedor de assinatura falso', () => {
  it('declara safety por metodo — sign e idempotent, verify e safe', () => {
    const p = createFakeSignatureProvider();
    expect(p.safety.sign).toBe('idempotent');
    expect(p.safety.verify).toBe('safe');
  });

  it('devolve PKCS#7, carimbo de tempo e material LTV — os tres, sempre', async () => {
    const p = createFakeSignatureProvider();
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]?.signatureP7s.byteLength).toBeGreaterThan(0);
      expect(r.value[0]?.timestampToken.byteLength).toBeGreaterThan(0);
      expect(r.value[0]?.ltvMaterial.byteLength).toBeGreaterThan(0);
    }
  });

  it('e idempotente: a mesma chave devolve a MESMA assinatura, byte a byte', async () => {
    const p = createFakeSignatureProvider();
    const a = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    const b = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    if (a.ok && b.ok) {
      expect(Buffer.from(a.value[0]!.signatureP7s).toString('hex'))
        .toBe(Buffer.from(b.value[0]!.signatureP7s).toString('hex'));
    }
  });

  it('verify aprova o que ele mesmo assinou e reprova bytes trocados', async () => {
    const p = createFakeSignatureProvider();
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    if (!r.ok) throw new Error('nao assinou');
    const payload = Buffer.from(doc.hashBase64, 'base64');
    const bom = await p.verify({ canonicalPayload: payload, signatureP7s: r.value[0]!.signatureP7s });
    expect(bom.ok && bom.value.status).toBe('valida');
    const ruim = await p.verify({
      canonicalPayload: Buffer.alloc(32, 9), signatureP7s: r.value[0]!.signatureP7s });
    expect(ruim.ok && ruim.value.status).toBe('invalida');
  });

  it('o modo indisponivel devolve unavailable — e como se testa a fila de pendencias', async () => {
    const p = createFakeSignatureProvider({ modo: 'indisponivel' });
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakeSignatureProvider({ modo: 'timeout' });
    const r = await p.sign(ctx, { signerRef: 's', documents: [doc] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });
});
