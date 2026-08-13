import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let sessao: SementeSessao;

beforeAll(async () => {
  sessao = await semearSessao({ role: 'profissional' });
});

afterAll(async () => { await closePools(); });

describe('bulário', () => {
  it('busca medicamentos por nome e devolve sua bula', async () => {
    const app = await buildApp();
    const busca = await app.inject({
      method: 'GET',
      url: '/v1/drugs/search?q=tylenol',
      ...auth(sessao),
    });

    expect(busca.statusCode).toBe(200);
    const medicamento = (busca.json() as { itens: { id: string; nome: string }[] }).itens
      .find((item) => item.nome === 'Tylenol 500mg');
    expect(medicamento).toBeDefined();

    const bula = await app.inject({
      method: 'GET',
      url: `/v1/drugs/${medicamento!.id}/leaflet?tipo=paciente`,
      ...auth(sessao),
    });

    expect(bula.statusCode).toBe(200);
    expect((bula.json() as { conteudo: string }).conteudo).toContain('TYLENOL 500 mg');
    await app.close();
  });
});
