import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('configuracoes da clinica', () => {
  it('GET /v1/configuracoes/clinica traz o perfil da unidade', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/clinica', ...auth(s) });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      clinicId: s.clinicId,
      nome: 'Unidade Sessao',
      cnes: '2077502',
      timezone: 'America/Sao_Paulo',
    });

    await app.close();
  });

  it('PUT /v1/configuracoes/clinica altera nome e fuso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/clinica', ...auth(s),
      payload: { nome: 'Unidade Renomeada', timezone: 'America/Manaus' } });

    expect(r.statusCode).toBe(200);
    const lido = await app.inject({
      method: 'GET', url: '/v1/configuracoes/clinica', ...auth(s) });
    expect(lido.json()).toMatchObject({
      nome: 'Unidade Renomeada', timezone: 'America/Manaus' });

    await app.close();
  });

  it('fuso invalido e recusado antes de gravar', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/clinica', ...auth(s),
      payload: { nome: 'Qualquer', timezone: 'Marte/Olympus' } });

    // O fuso da clinica decide a data de TODO evento do sistema (§10 item 10).
    // Gravar um invalido faria toda derivacao diaria falhar depois, longe daqui.
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'fuso_invalido' });

    await app.close();
  });

  it('GET /v1/configuracoes/equipe lista os vinculos com papel', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { userId: string; nome: string; email: string; role: string;
               ehProfissional: boolean; temTotp: boolean }[] }).itens;

    const eu = itens.find((x) => x.userId === s.userId);
    expect(eu?.role).toBe('admin_clinico');
    expect(eu?.email).toBe(`${s.userId}@example.test`);
    expect(eu?.ehProfissional).toBe(true);
    expect(typeof eu?.temTotp).toBe('boolean');

    await app.close();
  });

  it('recepcao nao altera a clinica', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/clinica', ...auth(recepcao),
      payload: { nome: 'Nao pode', timezone: 'America/Sao_Paulo' } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('equipe de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'admin_clinico' });
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(outro) });
    const itens = (r.json() as { itens: { userId: string }[] }).itens;
    expect(itens.some((x) => x.userId === s.userId)).toBe(false);
    await app.close();
  });
});
