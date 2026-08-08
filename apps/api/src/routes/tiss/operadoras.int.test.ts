// apps/api/src/routes/tiss/operadoras.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let medico: SementeSessao;

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  medico = await semearSessao({ role: 'profissional' });
});
afterAll(async () => { await closePools(); });

describe('rotas de operadoras TISS', () => {
  let operadoraId: string;

  it('POST /v1/tiss/operadoras cria operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/operadoras', ...auth(admin),
      payload: {
        nome: 'Unimed Teste',
        registroAns: '339679',
        cnpj: 'A1B2C3D4E5F601',
        tissVersion: '3.05',
        transportMode: 'arquivo',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { operadoraId: string };
    expect(body.operadoraId).toBeTruthy();
    operadoraId = body.operadoraId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/operadoras lista operadoras do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/operadoras', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ operadoraId: string; nome: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((o) => o.operadoraId === operadoraId)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/operadoras/:id detalhe da operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/operadoras/${operadoraId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { operadoraId: string; nome: string; registroAns: string };
    expect(body.nome).toBe('Unimed Teste');
    expect(body.registroAns).toBe('339679');
    await app.close();
  });

  it('PUT /v1/tiss/operadoras atualiza operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/tiss/operadoras', ...auth(admin),
      payload: { operadoraId, nome: 'Unimed Atualizada' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { operadoraId: string };
    expect(body.operadoraId).toBe(operadoraId);
    await app.close();
  });

  it('medico recebe 403 ao tentar criar operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/operadoras', ...auth(medico),
      payload: {
        nome: 'Operadora Proibida',
        registroAns: '111111',
        cnpj: 'X1Y2Z3W4V5U601',
        tissVersion: '3.05',
        transportMode: 'arquivo',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /v1/tiss/operadoras/:id desativa operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/tiss/operadoras/${operadoraId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { operadoraId: string }).operadoraId).toBe(operadoraId);
    await app.close();
  });
});
