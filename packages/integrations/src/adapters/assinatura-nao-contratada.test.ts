import { describe, expect, it } from 'vitest';
import { createUncontractedSignatureProvider } from './assinatura-nao-contratada';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: null, requestId: 'r',
  idempotencyKey: 'k', deadlineMs: 1000,
};

describe('assinatura sem PSC contratado', () => {
  it('RECUSA assinar — nunca devolve documento assinado', async () => {
    const p = createUncontractedSignatureProvider();
    const r = await p.sign(ctx, {
      signerRef: 's',
      documents: [{
        documentId: 'd1', hashAlgorithm: 'SHA-256', hashBase64: 'aGFzaA==',
        canonicalPayloadKey: 'k' as never, canonicalVersion: 'jcs-1',
        policy: 'AD_RT_CAdES_2.4', detached: true,
      }],
    });

    // O fake ASSINA com sucesso e reporta 'valida'. Usa-lo fora de
    // desenvolvimento grava atestado com signature_id e estado 'assinado' —
    // indistinguivel de ICP-Brasil real no banco, e sem valor legal nenhum.
    // Aqui a recusa e o comportamento correto: o documento sai PENDENTE.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('rejected');
    expect(r.error.retrySafe).toBe(false);
    expect(JSON.stringify(r.error)).toMatch(/psc_nao_contratado/);
  });

  it('verifica como INDETERMINADA, nunca como valida', async () => {
    const p = createUncontractedSignatureProvider();
    const r = await p.verify({
      canonicalPayload: new Uint8Array([1, 2, 3]),
      signatureP7s: new Uint8Array([4, 5, 6]),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 'invalida' afirmaria que a assinatura foi conferida e reprovada. Sem PSC
    // nada foi conferido, e o vocabulario da ICP-Brasil ja tem a palavra certa.
    expect(r.value.status).toBe('indeterminada');
    expect(r.value.reasons.join(' ')).toMatch(/psc_nao_contratado/);
  });

  it('nao inicia autorizacao de signatario', async () => {
    const p = createUncontractedSignatureProvider();
    const r = await p.authorizeSigner(ctx, { userId: 'u', redirectUri: 'https://x' });
    expect(r.ok).toBe(false);
  });

  it('se identifica de forma inconfundivel', () => {
    const p = createUncontractedSignatureProvider();
    // O id vai parar em log e em coluna de provider. `signature-fake` num
    // ambiente de producao seria lido como "alguem esqueceu o fake ligado";
    // este nome diz a verdade: falta contrato com PSC.
    expect(p.id).toBe('signature-nao-contratado');
  });
});
