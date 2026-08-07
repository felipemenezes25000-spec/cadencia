// apps/api/src/routes/finance-operations.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de a pagar (payables)', () => {
  let payableId: string;

  it('POST /v1/payables cria lancamento de despesa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(fin),
      payload: {
        description: 'Material de limpeza',
        amountCents: 8500,
        method: 'pix',
        dueDate: '2026-09-15',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { payableId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.payableId).toBeTruthy();
    payableId = body.payableId;
    await app.close();
  });

  it('GET /v1/payables lista despesas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string; kind: string }> };
    expect(body.itens.some((i) => i.payableId === payableId)).toBe(true);
    for (const item of body.itens) {
      expect(item.kind).toBe('despesa');
    }
    await app.close();
  });

  it('despesa de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string }> };
    expect(body.itens.map((i) => i.payableId)).not.toContain(payableId);
    await app.close();
  });

  it('recepcao nao cria despesa (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(recep),
      payload: {
        description: 'Teste', amountCents: 100, method: 'dinheiro',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de transferencias', () => {
  it('POST /v1/transfers cria transferencia entre contas', async () => {
    const app = await buildApp();

    // Criar duas contas bancarias primeiro
    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Origem', bankCode: '001', agency: '0001', accountNumber: '11111-0', initialBalanceCents: 500000 },
    });
    const fromId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Destino', bankCode: '341', agency: '0002', accountNumber: '22222-0', initialBalanceCents: 0 },
    });
    const toId = (r2.json() as { bankAccountId: string }).bankAccountId;

    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(fin),
      payload: {
        fromBankAccountId: fromId,
        toBankAccountId: toId,
        amountCents: 100000,
        description: 'Transferencia entre contas',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { transferId: string; debitEntryId: string; creditEntryId: string };
    expect(body.transferId).toBeTruthy();
    expect(body.debitEntryId).toBeTruthy();
    expect(body.creditEntryId).toBeTruthy();
    await app.close();
  });

  it('recepcao nao pode transferir (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(recep),
      payload: {
        fromBankAccountId: '01934567-89ab-7def-8123-456789abcde1',
        toBankAccountId: '01934567-89ab-7def-8123-456789abcde2',
        amountCents: 1000, description: 'Teste',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de recorrencias', () => {
  let recurringId: string;

  it('POST /v1/recurring cria template recorrente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(fin),
      payload: {
        description: 'Aluguel do consultorio',
        amountCents: 350000,
        kind: 'despesa',
        method: 'pix',
        frequency: 'monthly',
        dayOfMonth: 10,
        startsAt: '2026-09-01',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recurringId: string };
    expect(body.recurringId).toBeTruthy();
    recurringId = body.recurringId;
    await app.close();
  });

  it('GET /v1/recurring lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.some((i) => i.recurringId === recurringId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/recurring atualiza template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/recurring', ...auth(fin),
      payload: { recurringId, amountCents: 380000 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('DELETE /v1/recurring desativa template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/recurring/${recurringId}`, ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recurringId: string; active: boolean };
    expect(body.active).toBe(false);
    await app.close();
  });

  it('recorrencia de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.map((i) => i.recurringId)).not.toContain(recurringId);
    await app.close();
  });
});
