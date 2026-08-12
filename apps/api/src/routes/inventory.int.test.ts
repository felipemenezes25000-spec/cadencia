// apps/api/src/routes/inventory.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'admin_clinico' });
  outro = await semearSessao({ role: 'admin_clinico' });
});
afterAll(async () => { await closePools(); });

describe('rotas de produtos', () => {
  let productId: string;

  it('POST /v1/products cria produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: {
        name: 'Luva de procedimento M',
        sku: 'LUV-M-001',
        unit: 'cx',
        minStock: 10,
        currentStock: 50,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { productId: string };
    expect(body.productId).toBeTruthy();
    productId = body.productId;
    await app.close();
  });

  it('GET /v1/products lista produtos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.some((i) => i.productId === productId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/products atualiza produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/products', ...auth(fin),
      payload: { productId, name: 'Luva de procedimento M - 100un' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('produto de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.map((i) => i.productId)).not.toContain(productId);
    await app.close();
  });
});

describe('rotas de movimentacao de estoque', () => {
  let productId: string;

  it('registra entrada de estoque', async () => {
    const app = await buildApp();
    // Criar produto primeiro
    const rp = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Gaze esteril', sku: 'GAZ-001', unit: 'un', minStock: 5, currentStock: 20 },
    });
    productId = (rp.json() as { productId: string }).productId;

    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 30,
        kind: 'entrada',
        reason: 'Compra mensal',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    expect(body.movementId).toBeTruthy();
    // 20 do saldo inicial + 30 da entrada.
    //
    // Este número era 30, com um comentário explicando que o saldo inicial "não
    // é contabilizado pelo trigger" — o teste registrava o defeito em vez de
    // reprová-lo. `current_stock` é derivado: o trigger da migration 0101 soma
    // TODOS os movimentos e sobrescreve a coluna. Saldo inicial gravado só na
    // coluna, sem movimento, era apagado pela primeira movimentação — as 20
    // gazes sumiam do sistema no primeiro uso. Agora o cadastro abre o razão
    // com um `ajuste`, e coluna e razão contam a mesma história.
    expect(body.newStock).toBe(50);
    await app.close();
  });

  it('registra saida de estoque', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 5,
        kind: 'saida',
        reason: 'Uso em procedimento',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    // 20 (saldo inicial) + 30 (entrada) - 5 (saída) = 45
    expect(body.newStock).toBe(45);
    await app.close();
  });
});

describe('alertas de estoque', () => {
  it('GET /v1/stock-alerts retorna produtos abaixo do minimo', async () => {
    const app = await buildApp();

    // Criar produto com estoque abaixo do mínimo
    await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Seringa 5ml', sku: 'SER-5ML', unit: 'un', minStock: 100, currentStock: 3 },
    });

    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string; currentStock: number; minStock: number }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.currentStock).toBeLessThan(item.minStock);
    }
    await app.close();
  });

  it('alerta de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string }> };
    // Não pode conter os produtos do tenant fin
    expect(body.itens.every((i) => i.name !== 'Seringa 5ml')).toBe(true);
    await app.close();
  });

  it('profissional pode ler estoque (inventory.read)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(prof),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao pode ler estoque (inventory.read)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(recep),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao nao pode criar produto (inventory.write 403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(recep),
      payload: { name: 'Teste', sku: 'TST', unit: 'un', minStock: 1, currentStock: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
