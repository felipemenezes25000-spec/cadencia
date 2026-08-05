// apps/api/src/routes/payments.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('rotas de pagamento', () => {
  let paymentId: string;
  let receiptId: string;

  it('POST /v1/payments registra pagamento e gera recibo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 15000,
        method: 'pix',
        description: 'Consulta particular',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentId: string; status: string; receiptId: string };
    expect(body.status).toBe('confirmed');
    expect(body.paymentId).toBeTruthy();
    expect(body.receiptId).toBeTruthy();
    paymentId = body.paymentId;
    receiptId = body.receiptId;
    await app.close();
  });

  it('GET /v1/payments lista pagamentos com filtro por paciente', async () => {
    const app = await buildApp();

    const r = await app.inject({
      method: 'GET',
      url: `/v1/payments?patientId=${s.patientId}`,
      ...auth(s),
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('POST /v1/payments/:id/refund estorna o pagamento', async () => {
    const app = await buildApp();

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Paciente desistiu do atendimento' },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { paymentId: string; status: string };
    expect(body.status).toBe('refunded');
    await app.close();
  });

  it('estorno de pagamento ja estornado devolve 422', async () => {
    const app = await buildApp();

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      ...auth(s),
      payload: { reason: 'Segunda tentativa' },
    });

    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'pagamento_nao_estornavel' });
    await app.close();
  });

  it('recepcao nao pode estornar (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    // Criar um pagamento para a recepcao tentar estornar
    const criarR = await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(recep),
      payload: {
        patientId: recep.patientId,
        amountCents: 5000,
        method: 'dinheiro',
      },
    });
    const pid = (criarR.json() as { paymentId: string }).paymentId;

    const r = await app.inject({
      method: 'POST',
      url: `/v1/payments/${pid}/refund`,
      ...auth(recep),
      payload: { reason: 'Teste' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('POST /v1/payment-links cria link de pagamento', async () => {
    const app = await buildApp();

    const r = await app.inject({
      method: 'POST', url: '/v1/payment-links', ...auth(s),
      payload: {
        patientId: s.patientId,
        amountCents: 25000,
        description: 'Consulta + exames',
      },
    });

    expect(r.statusCode).toBe(201);
    const body = r.json() as { paymentLinkId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.paymentLinkId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/receipts/:id/pdf devolve o recibo em HTML', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/receipts/${receiptId}/pdf`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Recibo de Pagamento');
    expect(r.body).toContain('R$ 150.00');
    await app.close();
  });
});
