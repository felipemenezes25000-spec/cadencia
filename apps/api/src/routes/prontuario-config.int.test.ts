import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

interface Config {
  secoes: {
    sectionId: string; code: string; label: string;
    campos: { fieldId: string; code: string; label: string; kind: string;
              generation: number; unit: string | null;
              componentes: { ordinal: number; label: string; unit: string | null;
                             observationCode: string }[] }[];
  }[];
}

describe('configuracao do prontuario', () => {
  it('tenant novo nasce SEM secoes — a clinica escolhe o modelo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Config).secoes).toEqual([]);
    await app.close();
  });

  it('instanciar evolucao_livre cria secoes e campos do template', async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: 'POST', url: '/v1/configuracoes/prontuario/instanciar',
      payload: { templateCode: 'evolucao_livre' }, ...auth(s) });
    expect(post.statusCode).toBe(201);

    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(s) });
    const c = r.json() as Config;

    const evolucao = c.secoes.find((x) => x.code === 'evolucao');
    expect(evolucao?.label).toBe('Evolucao');
    const campo = evolucao?.campos.find((x) => x.code === 'evolucao');
    expect(campo?.kind).toBe('texto_longo');
    // A geracao nasce em 1 e e o que o valor gravado carrega. Sem ela, mudar o
    // tipo do campo depois tornaria ilegivel o que ja foi escrito.
    expect(campo?.generation).toBe(1);

    // O template tambem traz alergias — a barra lateral do atendimento le por
    // este code.
    const antec = c.secoes.find((x) => x.code === 'antecedentes');
    expect(antec?.campos.some((x) => x.code === 'alergias')).toBe(true);

    // Campo COMPOSTO precisa vir com seus componentes. Pressao arterial sem
    // sistolica e diastolica e uma caixa de texto onde o medico digita "12x8" —
    // e ai nao existe serie numerica, nem grafico, nem alerta de hipertensao.
    const vitais = c.secoes.find((x) => x.code === 'sinais_vitais');
    const pa = vitais?.campos.find((x) => x.code === 'pa');
    expect(pa?.kind).toBe('composto');
    expect(pa?.componentes.map((k) => k.observationCode)).toEqual(['PA_SIS', 'PA_DIA']);
    expect(pa?.componentes[0]?.unit).toBe('mmHg');

    // Campo numerico simples traz a unidade para a tela mostrar ao lado.
    expect(vitais?.campos.find((x) => x.code === 'peso')?.unit).toBe('kg');

    await app.close();
  });

  it('instanciar duas vezes nao duplica nem estoura unique', async () => {
    const app = await buildApp();
    const segundo = await app.inject({
      method: 'POST', url: '/v1/configuracoes/prontuario/instanciar',
      payload: { templateCode: 'evolucao_livre' }, ...auth(s) });
    // Clicar duas vezes no botao e o caso comum, nao o excepcional. A resposta
    // certa e dizer que nada foi criado, nao 500 com 23505.
    expect(segundo.statusCode).toBe(201);
    expect((segundo.json() as { criadas: number }).criadas).toBe(0);

    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(s) });
    const c = r.json() as Config;
    expect(c.secoes.filter((x) => x.code === 'evolucao')).toHaveLength(1);
    await app.close();
  });

  it('template inexistente devolve 422, nao cria nada', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'profissional' });
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/prontuario/instanciar',
      payload: { templateCode: 'nao_existe' }, ...auth(outro) });
    expect(r.statusCode).toBe(422);

    const g = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(outro) });
    expect((g.json() as Config).secoes).toEqual([]);
    await app.close();
  });

  it('recepcao nao configura prontuario', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/prontuario/instanciar',
      payload: { templateCode: 'evolucao_livre' }, ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
