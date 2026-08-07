// apps/api/src/routes/fase3-isolation.int.test.ts
//
// Canario de isolamento multi-tenant para as rotas da Fase 3.
// Garantia: nenhuma rota nova vaza dado de um tenant para outro.
//
// DIVERGENCIAS em relacao ao plano original (task-57):
// 1. POST /v1/split-rules usa { professionalId, percentage, priority } em vez de
//    { professionalId, clinicPercentage, professionalPercentage }.
//    Resposta devolve { ruleId } em vez de { splitRuleId }.
// 2. GET /v1/split-rules devolve { rules: [{ id }] } em vez de { itens: [{ splitRuleId }] }.
// 3. GET /v1/repasse/statements devolve { statements: [] } em vez de { itens: [] },
//    e nao aceita from/to como query params — somente professionalId e status.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let a: SementeSessao;
let b: SementeSessao;

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });
});
afterAll(async () => { await closePools(); });

describe('isolamento multi-tenant — rotas da Fase 3', () => {
  let bankAccountId: string;
  let costCenterId: string;
  let supplierId: string;
  let productId: string;
  let splitRuleId: string;
  let recurringId: string;

  it('semear dados no tenant A', async () => {
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(a),
      payload: { name: 'Conta Iso', bankCode: '001', agency: '0001', accountNumber: '99999-0', initialBalanceCents: 0 },
    });
    bankAccountId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(a),
      payload: { name: 'CC Iso', code: 'ISO01' },
    });
    costCenterId = (r2.json() as { costCenterId: string }).costCenterId;

    const r3 = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(a),
      payload: { name: 'Fornecedor Iso' },
    });
    supplierId = (r3.json() as { supplierId: string }).supplierId;

    const r4 = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(a),
      payload: { name: 'Produto Iso', sku: 'ISO-001', unit: 'un', minStock: 1, currentStock: 10 },
    });
    productId = (r4.json() as { productId: string }).productId;

    const r5 = await app.inject({
      method: 'POST', url: '/v1/split-rules', ...auth(a),
      payload: { professionalId: a.professionalId, percentage: 50, priority: 1 },
    });
    splitRuleId = (r5.json() as { ruleId: string }).ruleId;

    const r6 = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(a),
      payload: { description: 'Recorrencia Iso', amountCents: 10000, kind: 'despesa', method: 'pix', frequency: 'monthly', dayOfMonth: 1, startsAt: '2026-09-01' },
    });
    recurringId = (r6.json() as { recurringId: string }).recurringId;

    await app.close();
  });

  it('contas bancarias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/bank-accounts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ bankAccountId: string }> }).itens.map((i) => i.bankAccountId);
    expect(ids).not.toContain(bankAccountId);
    await app.close();
  });

  it('centros de custo do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/cost-centers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ costCenterId: string }> }).itens.map((i) => i.costCenterId);
    expect(ids).not.toContain(costCenterId);
    await app.close();
  });

  it('fornecedores do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/suppliers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ supplierId: string }> }).itens.map((i) => i.supplierId);
    expect(ids).not.toContain(supplierId);
    await app.close();
  });

  it('produtos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/products', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('alertas de estoque do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/stock-alerts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('split rules do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/split-rules', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { rules: Array<{ id: string }> }).rules.map((i) => i.id);
    expect(ids).not.toContain(splitRuleId);
    await app.close();
  });

  it('recorrencias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/recurring', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ recurringId: string }> }).itens.map((i) => i.recurringId);
    expect(ids).not.toContain(recurringId);
    await app.close();
  });

  it('repasse do tenant A nao aparece no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${a.professionalId}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { statements: unknown[] };
    expect(body.statements.length).toBe(0);
    await app.close();
  });

  it('relatorio do tenant A nao vaza para o tenant B', async () => {
    const app = await buildApp();
    // Criar pagamento no tenant A
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(a),
      payload: { patientId: a.patientId, amountCents: 50000, method: 'pix' },
    });
    // Variacao do tenant B deve ser zero
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });
});
