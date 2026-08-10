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

describe('convite de equipe', () => {
  it('convida novo usuario com dados validos: 201', async () => {
    const app = await buildApp();
    const email = `convite-${Date.now()}@test.local`;
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Novo Recepcao', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });

    expect(r.statusCode).toBe(201);
    const body = r.json() as { userId: string; membershipId: string };
    expect(body.userId).toBeDefined();
    expect(body.membershipId).toBeDefined();

    const lista = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s),
    });
    const itens = (lista.json() as { itens: { userId: string }[] }).itens;
    expect(itens.some((x) => x.userId === body.userId)).toBe(true);

    await app.close();
  });

  it('profissional sem dados de conselho: 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email: `prof-${Date.now()}@test.local`, nome: 'Dr Sem Conselho',
        role: 'profissional', senhaTemporaria: 'Temp@2026xx',
      },
    });

    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'dados_profissionais_obrigatorios' });
    await app.close();
  });

  it('convite duplicado (mesmo email + role + clinica): 409', async () => {
    const app = await buildApp();
    const email = `dup-${Date.now()}@test.local`;
    const payload = {
      email, nome: 'Dup User', role: 'recepcao',
      senhaTemporaria: 'Temp@2026xx',
    };

    const r1 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload,
    });
    expect(r1.statusCode).toBe(201);

    const r2 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload,
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json()).toMatchObject({ erro: 'vinculo_duplicado' });

    await app.close();
  });

  it('email existente reutiliza user_id', async () => {
    const app = await buildApp();
    const email = `reuso-${Date.now()}@test.local`;

    const r1 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Reuso User', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });
    expect(r1.statusCode).toBe(201);
    const userId1 = (r1.json() as { userId: string }).userId;

    await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${userId1}/role/recepcao`,
      ...auth(s),
    });

    const r2 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Reuso User', role: 'financeiro',
        senhaTemporaria: 'OutraSenha@2026',
      },
    });
    expect(r2.statusCode).toBe(201);
    const userId2 = (r2.json() as { userId: string }).userId;
    expect(userId2).toBe(userId1);

    await app.close();
  });

  it('recepcao nao pode convidar: 403', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(recepcao),
      payload: {
        email: `nope-${Date.now()}@test.local`, nome: 'Nope',
        role: 'recepcao', senhaTemporaria: 'Temp@2026xx',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('convida profissional com dados de conselho: 201', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email: `drprof-${Date.now()}@test.local`, nome: 'Dr Profissional',
        role: 'profissional', senhaTemporaria: 'Temp@2026xx',
        conselho: '06', numeroConselho: '54321', ufConselho: 'RJ',
      },
    });
    expect(r.statusCode).toBe(201);

    const body = r.json() as { userId: string };
    const lista = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s),
    });
    const itens = (lista.json() as {
      itens: { userId: string; conselho: string | null }[]
    }).itens;
    const prof = itens.find((x) => x.userId === body.userId);
    expect(prof?.conselho).toContain('54321');

    await app.close();
  });
});
