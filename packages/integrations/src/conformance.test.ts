import { describe, expect, it } from 'vitest';
import { assertNoDuplicateOnTimeout, assertSafetyDeclared } from './conformance';
import { createFakePrescriptionProvider } from './fakes/prescription-fake';
import { createFakeSignatureProvider } from './fakes/signature-fake';
import { createFakeMessagingProvider } from './fakes/messaging-fake';
import { createFakePaymentProvider } from './fakes/payment-fake';
import { asE164, type ProviderCtx } from './contracts/common';

const msgCtx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'conformidade-msg', deadlineMs: 3000,
};

describe('conformidade obrigatoria por adaptador', () => {
  it('todo provedor declara safety para TODOS os metodos publicos', () => {
    expect(assertSafetyDeclared(createFakeSignatureProvider(),
      ['authorizeSigner', 'completeAuthorization', 'sign', 'verify', 'retimestamp'])).toBe(true);
    expect(assertSafetyDeclared(createFakePrescriptionProvider(),
      ['openPrescriberSession', 'fetchPrescription', 'fetchSignedArtifact'])).toBe(true);
    expect(assertSafetyDeclared(createFakeMessagingProvider(),
      ['registerChannelIdentity', 'send', 'findByIdempotencyKey',
       'verifyWebhook', 'parseInbound', 'fetchMedia'])).toBe(true);
    expect(assertSafetyDeclared(createFakePaymentProvider(),
      ['createPaymentLink', 'getPayment', 'refund', 'fetchSettlements'])).toBe(true);
  });

  it('reprova provedor que esqueceu de declarar a safety de um metodo', () => {
    const p = createFakeSignatureProvider();
    expect(() => assertSafetyDeclared(p, ['metodoInexistente']))
      .toThrow(/safety nao declarada para metodoInexistente/);
  });

  it('timeout com efeito NAO duplica: a segunda chamada devolve o MESMO resultado', async () => {
    let chamadas = 0;
    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        return chamadas === 1 ? { estado: 'timeout' as const } : { estado: 'ok' as const, id: 'X' };
      },
      reconciliar: async () => ({ jaExiste: true, id: 'X' }),
    });
    expect(r).toEqual({ duplicou: false, id: 'X', viaReconciliacao: true });
  });

  it('reprova o adaptador que reenvia cegamente apos timeout', async () => {
    await expect(assertNoDuplicateOnTimeout({
      operacao: async () => ({ estado: 'ok' as const, id: `novo-${Math.random()}` }),
      reconciliar: async () => ({ jaExiste: false, id: null }),
      simularEfeitoNoTimeout: true,
    })).rejects.toThrow(/duplicou/);
  });

  it('messaging: timeout em send NAO duplica gracas a findByIdempotencyKey', async () => {
    const p = createFakeMessagingProvider();
    const phone = asE164('+5511987654321')!;
    let chamadas = 0;

    const r = await assertNoDuplicateOnTimeout({
      operacao: async () => {
        chamadas += 1;
        if (chamadas === 1) {
          // simula: a primeira chamada funciona mas o caller ve timeout
          await p.send(msgCtx, {
            channelIdentityRef: 'id-1', to: phone,
            body: { kind: 'text', text: 'lembrete' },
            conversationId: 'conv-conf',
          });
          return { estado: 'timeout' as const };
        }
        // segunda chamada: o caller tenta de novo com a mesma idempotencyKey
        const r2 = await p.send(msgCtx, {
          channelIdentityRef: 'id-1', to: phone,
          body: { kind: 'text', text: 'lembrete' },
          conversationId: 'conv-conf',
        });
        if (!r2.ok) return { estado: 'timeout' as const };
        return { estado: 'ok' as const, id: r2.value.providerMessageId };
      },
      reconciliar: async () => {
        const found = await p.findByIdempotencyKey(msgCtx, { key: msgCtx.idempotencyKey });
        if (found.ok && found.value !== null) {
          return { jaExiste: true, id: found.value.providerMessageId };
        }
        return { jaExiste: false, id: null };
      },
    });

    expect(r.duplicou).toBe(false);
    expect(r.viaReconciliacao).toBe(true);
    // o fake so enviou UMA vez, nao duplicou
    expect(p.sent).toHaveLength(1);
  });
});
