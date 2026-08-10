import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

describe('ficha do paciente', () => {
  it('GET /v1/pacientes/:id traz o cadastro para o cabecalho da ficha', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      patientId: s.patientId,
      displayName: s.patientNome,
      legalName: s.patientNome,
      cadastroStatus: 'completo',
    });

    await app.close();
  });

  it('paciente de outro tenant devolve 404, nao 403', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'profissional' });
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}`, ...auth(outro) });

    // 403 diria "existe e voce nao pode ver", que ja e um vazamento: confirma a
    // existencia de um cadastro em outra clinica. A RLS devolve conjunto vazio
    // e a rota traduz isso como nao encontrado.
    expect(r.statusCode).toBe(404);

    await app.close();
  });

  it('o historico traz o nome do profissional, nao o uuid', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { encounterId: string; profissionalNome: string }[] }).itens;

    expect(itens.length).toBeGreaterThan(0);
    const primeiro = itens[0];
    expect(primeiro?.profissionalNome).toBeTruthy();
    expect(primeiro?.profissionalNome).not.toMatch(/^[0-9a-f]{8}-/);

    await app.close();
  });
});
