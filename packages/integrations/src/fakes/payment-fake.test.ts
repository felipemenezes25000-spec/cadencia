import { describe, expect, it } from 'vitest';
import { assertSafetyDeclared } from '../conformance';
import { type ProviderCtx } from '../contracts/common';
import { createFakePaymentProvider } from './payment-fake';

function ctx(key: string): ProviderCtx {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorUserId: '00000000-0000-0000-0000-000000000002',
    requestId: '00000000-0000-0000-0000-000000000003',
    idempotencyKey: key,
    deadlineMs: 5000,
  };
}

describe('PaymentProvider fake', () => {
  it('declara safety para todos os metodos', () => {
    const p = createFakePaymentProvider();
    expect(assertSafetyDeclared(p, [
      'createPaymentLink', 'getPayment', 'refund', 'fetchSettlements',
    ])).toBe(true);
  });

  it('cria link, consulta e estorna', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('link-1'), {
      amountCents: 25000,
      description: 'Consulta particular',
      expiresInMinutes: 30,
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.value.paymentUrl).toContain('fake-pay-link-1');

    const get = await p.getPayment(ctx('get-1'), {
      providerPaymentId: link.value.providerPaymentId,
    });
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.status).toBe('pending');
      expect(get.value.amountCents).toBe(25000);
    }

    const refund = await p.refund(ctx('refund-1'), {
      providerPaymentId: link.value.providerPaymentId,
      reason: 'paciente desistiu',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('refunded');
    }
  });

  it('modo indisponivel retorna unavailable com retrySafe', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const r = await p.createPaymentLink(ctx('indisp-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unavailable');
      expect(r.error.retrySafe).toBe(true);
    }
  });

  it('modo timeout retorna timeout sem retrySafe — ESTADO DESCONHECIDO', async () => {
    const p = createFakePaymentProvider({ modo: 'timeout' });
    const r = await p.createPaymentLink(ctx('timeout-1'), {
      amountCents: 10000,
      description: 'Teste',
      expiresInMinutes: 15,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  it('health retorna up=false quando indisponivel', async () => {
    const p = createFakePaymentProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('verifyWebhook do fake valida HMAC corretamente', () => {
    const { createHmac } = require('node:crypto');
    const p = createFakePaymentProvider();
    const body = Buffer.from('{}');
    const sig = createHmac('sha256', 'fake-payment-secret').update(body).digest('hex');
    expect(p.verifyWebhook(body, { 'x-webhook-signature': sig })).toEqual({ valid: true });
  });

  it('verifyWebhook do fake rejeita assinatura invalida', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), { 'x-webhook-signature': 'invalida' }))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('verifyWebhook do fake rejeita header ausente', () => {
    const p = createFakePaymentProvider();
    expect(p.verifyWebhook(Buffer.from('{}'), {}))
      .toEqual({ valid: false, reason: 'header x-webhook-signature ausente' });
  });

  it('estorno parcial marca como partially_refunded', async () => {
    const p = createFakePaymentProvider();
    const link = await p.createPaymentLink(ctx('partial-1'), {
      amountCents: 25000,
      description: 'Consulta',
      expiresInMinutes: 30,
    });
    if (!link.ok) return;

    const refund = await p.refund(ctx('partial-ref-1'), {
      providerPaymentId: link.value.providerPaymentId,
      amountCents: 10000,
      reason: 'estorno parcial',
    });
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.value.status).toBe('partially_refunded');
    }
  });
});
