import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let sessao: SementeSessao;

beforeAll(async () => {
  sessao = await semearSessao({ role: 'admin_clinico' });
});

afterAll(async () => { await closePools(); });

describe('planos de cobranca', () => {
  it('GET /v1/billing/plans devolve os planos sem erro de serializacao', async () => {
    const app = await buildApp();
    const resposta = await app.inject({
      method: 'GET',
      url: '/v1/billing/plans',
      ...auth(sessao),
    });

    expect(resposta.statusCode).toBe(200);
    expect((resposta.json() as { itens: { slug: string }[] }).itens)
      .toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'basico' })]));

    await app.close();
  });
});
