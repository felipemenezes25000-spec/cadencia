import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

describe('lista de espera', () => {
  it('POST /v1/agenda/lista-espera adiciona e GET devolve a fila', async () => {
    const app = await buildApp();

    const criada = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(s),
      payload: {
        patientId: s.patientId,
        professionalId: s.professionalId,
        prioridade: 'normal',
        observacao: 'Prefere manha',
      },
    });
    expect(criada.statusCode).toBe(201);
    const { waitlistId } = criada.json() as { waitlistId: string };

    const fila = await app.inject({
      method: 'GET', url: '/v1/agenda/lista-espera', ...auth(s) });
    expect(fila.statusCode).toBe(200);
    const itens = (fila.json() as {
      itens: { waitlistId: string; patientNome: string; prioridade: string }[] }).itens;
    const nossa = itens.find((i) => i.waitlistId === waitlistId);
    expect(nossa).toBeDefined();
    expect(nossa?.patientNome).toBe(s.patientNome);

    await app.close();
  });

  it('urgente vem antes de normal, e entre iguais vence quem esperou mais', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'recepcao' });

    // Dois pacientes distintos: o índice único impede duas entradas ativas para
    // o mesmo par paciente/profissional.
    const normal = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId, prioridade: 'normal' } });
    const urgente = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientPreliminarId, prioridade: 'urgente' } });
    expect(normal.statusCode).toBe(201);
    expect(urgente.statusCode).toBe(201);

    const fila = await app.inject({
      method: 'GET', url: '/v1/agenda/lista-espera', ...auth(t) });
    const itens = (fila.json() as { itens: { waitlistId: string }[] }).itens;
    expect(itens[0]?.waitlistId).toBe((urgente.json() as { waitlistId: string }).waitlistId);

    await app.close();
  });

  it('o mesmo paciente nao entra duas vezes na fila do mesmo profissional', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'recepcao' });

    const primeira = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId, professionalId: t.professionalId } });
    const segunda = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId, professionalId: t.professionalId } });

    expect(primeira.statusCode).toBe(201);
    // Fila com a mesma pessoa duas vezes não é fila: é a recepção ligando duas
    // vezes para a mesma paciente e ela achando que perdeu a vaga.
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json()).toMatchObject({ erro: 'ja_na_fila' });

    await app.close();
  });

  it('DELETE encerra a entrada com motivo e ela sai da fila', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'recepcao' });

    const criada = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId } });
    const { waitlistId } = criada.json() as { waitlistId: string };

    const saida = await app.inject({
      method: 'DELETE', url: `/v1/agenda/lista-espera/${waitlistId}`, ...auth(t),
      payload: { motivo: 'desistiu' } });
    expect(saida.statusCode).toBe(200);

    const fila = await app.inject({
      method: 'GET', url: '/v1/agenda/lista-espera', ...auth(t) });
    const itens = (fila.json() as { itens: { waitlistId: string }[] }).itens;
    expect(itens.find((i) => i.waitlistId === waitlistId)).toBeUndefined();

    await app.close();
  });

  it('encerrar libera a vaga: o mesmo paciente pode voltar para a fila', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'recepcao' });

    const primeira = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId } });
    await app.inject({
      method: 'DELETE',
      url: `/v1/agenda/lista-espera/${(primeira.json() as { waitlistId: string }).waitlistId}`,
      ...auth(t), payload: { motivo: 'desistiu' } });

    const devolta = await app.inject({
      method: 'POST', url: '/v1/agenda/lista-espera', ...auth(t),
      payload: { patientId: t.patientId } });
    expect(devolta.statusCode).toBe(201);

    await app.close();
  });
});
