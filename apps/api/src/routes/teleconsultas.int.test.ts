import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let sessao: SementeSessao;

beforeAll(async () => {
  sessao = await semearSessao({ role: 'profissional' });
});

afterAll(async () => { await closePools(); });

describe('teleconsulta routes', () => {
  it('POST /v1/teleconsultas — cria sala de teleconsulta', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teleconsultas',
      payload: { appointmentId: sessao.appointmentId },
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; roomId: string; roomUrl: string };
    expect(body.id).toBeDefined();
    expect(body.roomId).toContain('fake-room');
    expect(body.roomUrl).toContain('https://fake-teleconsult/');

    await app.close();
  });

  it('POST /v1/teleconsultas — rejeita duplicata', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teleconsultas',
      payload: { appointmentId: sessao.appointmentId },
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ erro: 'teleconsulta_ja_existe' });

    await app.close();
  });

  it('GET /v1/teleconsultas/:appointmentId — retorna sala existente', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/teleconsultas/${sessao.appointmentId}`,
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; roomId: string; roomUrl: string; provider: string; endedAt: string | null };
    expect(body.roomId).toContain('fake-room');
    expect(body.provider).toBe('jitsi');
    expect(body.endedAt).toBeNull();

    await app.close();
  });

  it('PUT /v1/teleconsultas/:id/encerrar — encerra teleconsulta', async () => {
    const app = await buildApp();

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/teleconsultas/${sessao.appointmentId}`,
      ...auth(sessao),
    });
    const teleconsultaId = (getRes.json() as { id: string }).id;

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/teleconsultas/${teleconsultaId}/encerrar`,
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });

  it('PUT /v1/teleconsultas/:id/encerrar — rejeita teleconsulta ja encerrada', async () => {
    const app = await buildApp();

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/teleconsultas/${sessao.appointmentId}`,
      ...auth(sessao),
    });
    const teleconsultaId = (getRes.json() as { id: string }).id;

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/teleconsultas/${teleconsultaId}/encerrar`,
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ erro: 'teleconsulta_ja_encerrada' });

    await app.close();
  });

  it('POST /v1/teleconsultas — rejeita agendamento inexistente', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teleconsultas',
      payload: { appointmentId: '00000000-0000-0000-0000-000000000000' },
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ erro: 'agendamento_nao_encontrado' });

    await app.close();
  });

  it('GET /v1/teleconsultas/:appointmentId — 404 para agendamento sem teleconsulta', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/teleconsultas/00000000-0000-0000-0000-000000000000',
      ...auth(sessao),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ erro: 'teleconsulta_nao_encontrada' });

    await app.close();
  });
});
