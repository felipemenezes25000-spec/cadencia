import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

/** Um dia futuro, para não colidir com o que a semente já criou. */
function faixa(diaOffset: number, horaInicio: number, horaFim: number) {
  const d = new Date(Date.UTC(2030, 5, 10 + diaOffset));
  const ini = new Date(d); ini.setUTCHours(horaInicio, 0, 0, 0);
  const fim = new Date(d); fim.setUTCHours(horaFim, 0, 0, 0);
  return { startsAt: ini.toISOString(), endsAt: fim.toISOString() };
}

describe('bloqueios e observacoes da agenda', () => {
  it('cria um bloqueio com motivo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/bloqueios',
      payload: {
        ...faixa(0, 12, 13), kind: 'almoco',
        motivo: 'Almoco da equipe', professionalId: s.professionalId,
      },
      ...auth(s) });

    expect(r.statusCode).toBe(201);
    expect((r.json() as { blockId: string }).blockId).toBeTruthy();
    await app.close();
  });

  it('motivo em branco e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/bloqueios',
      payload: { ...faixa(1, 8, 9), kind: 'bloqueio', motivo: '  ' },
      ...auth(s) });
    // `motivo` é NOT NULL no banco. Bloqueio sem motivo vira buraco na agenda
    // que ninguém sabe explicar — e a recepção acaba desbloqueando por engano.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('fim antes do inicio e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/bloqueios',
      payload: { ...faixa(2, 15, 14), kind: 'bloqueio', motivo: 'invertido' },
      ...auth(s) });
    // CHECK (ends_at > starts_at). Recusar aqui devolve validação em vez de 500.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('dois bloqueios sobrepostos do mesmo profissional sao recusados', async () => {
    const app = await buildApp();
    const f = faixa(3, 9, 11);
    const primeiro = await app.inject({
      method: 'POST', url: '/v1/agenda/bloqueios',
      payload: { ...f, kind: 'ausencia', motivo: 'Consulta medica',
                 professionalId: s.professionalId },
      ...auth(s) });
    expect(primeiro.statusCode).toBe(201);

    const segundo = await app.inject({
      method: 'POST', url: '/v1/agenda/bloqueios',
      payload: {
        ...faixa(3, 10, 12), kind: 'bloqueio', motivo: 'Outro',
        professionalId: s.professionalId,
      },
      ...auth(s) });
    // `ex_block_sem_sobreposicao` no banco. Devolver 409 em vez de 500 diz a
    // recepção o que aconteceu: já existe bloqueio naquele horário.
    expect(segundo.statusCode).toBe(409);
    await app.close();
  });

  it('lista os bloqueios do dia', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/agenda/bloqueios?de=2030-06-10&ate=2030-06-14',
      ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      blockId: string; kind: string; motivo: string;
      startsAt: string; endsAt: string; professionalNome: string | null }[] }).itens;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.some((x) => x.motivo === 'Almoco da equipe')).toBe(true);
    await app.close();
  });

  it('remover libera o horario', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: '/v1/agenda/bloqueios?de=2030-06-10&ate=2030-06-14',
      ...auth(s) });
    const alvo = (lista.json() as { itens: { blockId: string; motivo: string }[] })
      .itens.find((x) => x.motivo === 'Almoco da equipe');

    const del = await app.inject({
      method: 'DELETE', url: `/v1/agenda/bloqueios/${alvo?.blockId}`, ...auth(s) });
    expect(del.statusCode).toBe(204);

    const depois = await app.inject({
      method: 'GET', url: '/v1/agenda/bloqueios?de=2030-06-10&ate=2030-06-14',
      ...auth(s) });
    expect((depois.json() as { itens: { motivo: string }[] }).itens
      .some((x) => x.motivo === 'Almoco da equipe')).toBe(false);
    await app.close();
  });
});
