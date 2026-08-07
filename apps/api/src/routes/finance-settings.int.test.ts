// apps/api/src/routes/finance-settings.int.test.ts
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

describe('rotas de contas bancarias', () => {
  let bankAccountId: string;

  it('POST /v1/bank-accounts cria conta bancaria', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        name: 'Bradesco Corrente',
        bankCode: '237',
        agency: '1234',
        accountNumber: '56789-0',
        initialBalanceCents: 100000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBeTruthy();
    bankAccountId = body.bankAccountId;
    await app.close();
  });

  it('GET /v1/bank-accounts lista contas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((i) => i.bankAccountId === bankAccountId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/bank-accounts atualiza conta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        bankAccountId,
        name: 'Bradesco Corrente Principal',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBe(bankAccountId);
    await app.close();
  });

  it('conta bancaria de outro tenant nao aparece na listagem', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.map((i) => i.bankAccountId)).not.toContain(bankAccountId);
    await app.close();
  });

  it('recepcao nao acessa contas bancarias (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de centros de custo', () => {
  let costCenterId: string;

  it('POST /v1/cost-centers cria centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(fin),
      payload: { name: 'Consultorio 1', code: 'CC01' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { costCenterId: string };
    expect(body.costCenterId).toBeTruthy();
    costCenterId = body.costCenterId;
    await app.close();
  });

  it('GET /v1/cost-centers lista centros de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.some((i) => i.costCenterId === costCenterId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/cost-centers atualiza centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/cost-centers', ...auth(fin),
      payload: { costCenterId, name: 'Consultorio Principal' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('centro de custo de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.map((i) => i.costCenterId)).not.toContain(costCenterId);
    await app.close();
  });
});

describe('rotas de fornecedores', () => {
  let supplierId: string;

  it('POST /v1/suppliers cria fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(fin),
      payload: {
        name: 'Distribuidora Medica ABC',
        cnpj: '12345678000195',
        phone: '11999887766',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { supplierId: string };
    expect(body.supplierId).toBeTruthy();
    supplierId = body.supplierId;
    await app.close();
  });

  it('GET /v1/suppliers lista fornecedores', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.some((i) => i.supplierId === supplierId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/suppliers atualiza fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/suppliers', ...auth(fin),
      payload: { supplierId, name: 'Distribuidora Medica ABC Ltda' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('fornecedor de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.map((i) => i.supplierId)).not.toContain(supplierId);
    await app.close();
  });
});
