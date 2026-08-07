// apps/api/src/routes/reports.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  serializerCompiler, validatorCompiler,
} from 'fastify-type-provider-zod';
import { reportRoutes } from './reports';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Registrar as rotas sem autenticacao para teste unitario de contrato
  // (teste de integracao com banco e com authn/authz roda no CI)
  await app.register(async (instance) => {
    await reportRoutes(instance);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('rotas de relatorio — contrato HTTP', () => {
  it('GET /v1/reports/views retorna array com as 11 visoes built-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.views).toHaveLength(11);
    expect(body.views[0]).toHaveProperty('id');
    expect(body.views[0]).toHaveProperty('name');
    expect(body.views[0]).toHaveProperty('builtIn', true);
  });

  it('GET /v1/reports/views/:id retorna visao especifica', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/reports/views/builtin-atendimentos-realizados',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('builtin-atendimentos-realizados');
    expect(body.name).toBe('Atendimentos realizados');
  });

  it('GET /v1/reports/views/:id retorna 404 para id inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reports/views/nao-existe' });
    expect(res.statusCode).toBe(404);
  });
});
