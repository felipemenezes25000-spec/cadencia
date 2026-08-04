import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';

describe('casca da API', () => {
  afterAll(async () => { await closePools(); });

  it('responde /health sem tocar no banco', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('TODA resposta sai com no-store — dado pessoal nao e cacheavel', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['pragma']).toBe('no-cache');
    await app.close();
  });

  it('erro de validacao Zod vira 400 com o caminho do campo, nao stack trace', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/echo?n=abc' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ erro: 'validacao', campos: [{ path: 'n' }] });
    expect(JSON.stringify(r.json())).not.toContain('at Object');
    await app.close();
  });

  it('gera OpenAPI a partir dos mesmos schemas Zod das rotas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('paths./v1/echo');
    await app.close();
  });

  it('rota desconhecida devolve 404 sem revelar a arvore de rotas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/nao-existe' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ erro: 'nao_encontrado' });
    await app.close();
  });
});
