import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

describe('rotas de atendimento', () => {
  it('POST /v1/atendimentos abre o atendimento a partir do agendamento', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId, appointmentId: s.appointmentId } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'rascunho', rev: 1 });
    await app.close();
  });

  it('PUT /v1/atendimentos/:id/rascunho grava com revisao otimista', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`,
      ...auth(s), payload: { expectedRev: 1, payload: { queixa: 'cefaleia' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ rev: 2 });
    await app.close();
  });

  it('revisao velha devolve 409 com o payload vigente para a tela reconciliar', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`, ...auth(s),
      payload: { expectedRev: 1, payload: { queixa: 'a' } } });
    const r = await app.inject({ method: 'PUT', url: `/v1/atendimentos/${id}/rascunho`,
      ...auth(s), payload: { expectedRev: 1, payload: { queixa: 'b' } } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ erro: 'conflito_de_revisao', currentRev: 2 });
    await app.close();
  });

  it('POST /finalizar sela e devolve o id da versao', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'POST', url: `/v1/atendimentos/${id}/finalizar`,
      ...auth(s), payload: { fields: [], diagnoses: [], observations: [],
                             findings: [], procedures: [], ai: [] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ versionNo: 1 });
    await app.close();
  });

  it('cadastro preliminar devolve 422 dizendo o que falta', async () => {
    const app = await buildApp();
    const abrir = await app.inject({ method: 'POST', url: '/v1/atendimentos', ...auth(s),
      payload: { patientId: s.patientPreliminarId } });
    const id = (abrir.json() as { encounterId: string }).encounterId;
    const r = await app.inject({ method: 'POST', url: `/v1/atendimentos/${id}/finalizar`,
      ...auth(s), payload: { fields: [], diagnoses: [], observations: [],
                             findings: [], procedures: [], ai: [] } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      erro: 'cadastro_preliminar_bloqueia_finalizacao', faltando: expect.any(Array) });
    await app.close();
  });

  it('GET /v1/pacientes/:id/prontuario devolve a linha do tempo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray((r.json() as { itens: unknown[] }).itens)).toBe(true);
    await app.close();
  });
});
