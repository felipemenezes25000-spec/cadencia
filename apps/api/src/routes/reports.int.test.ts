// apps/api/src/routes/reports.int.test.ts
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

describe('rotas de relatorios', () => {
  it('GET /v1/reports/variation retorna variacoes do periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      revenue: { currentCents: number; previousCents: number; variationPercent: number };
      expenses: { currentCents: number; previousCents: number; variationPercent: number };
    };
    expect(typeof body.revenue.currentCents).toBe('number');
    expect(typeof body.revenue.previousCents).toBe('number');
    expect(typeof body.revenue.variationPercent).toBe('number');
    expect(typeof body.expenses.currentCents).toBe('number');
    await app.close();
  });

  it('GET /v1/reports/explore retorna dados de exploracao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/explore?from=2026-07-01&to=2026-07-31&groupBy=category',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; period: { from: string; to: string } };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.period.from).toBe('2026-07-01');
    expect(body.period.to).toBe('2026-07-31');
    await app.close();
  });

  it('GET /v1/reports/views/:viewId retorna visao salva', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/views/revenue-by-professional?from=2026-07-01&to=2026-07-31',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { viewId: string; data: unknown[] };
    expect(body.viewId).toBe('revenue-by-professional');
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });

  it('GET /v1/reports/export retorna CSV com header correto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/export?from=2026-07-01&to=2026-07-31&format=csv',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('relatorio nunca retorna dados de outro tenant', async () => {
    // Criar um pagamento no tenant fin
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(fin),
      payload: { patientId: fin.patientId, amountCents: 10000, method: 'pix' },
    });

    // Relatorio do outro tenant nao deve conter esses dados
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    // O tenant outro nao tem pagamentos, entao currentCents deve ser 0
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('recepcao nao acessa relatorios (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('profissional nao acessa relatorios (403)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(prof),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
