import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, auth, type SementeSessao } from './test-support';

let a: SementeSessao; let b: SementeSessao;

beforeAll(async () => {
  a = await semearSessao({ role: 'profissional' });
  b = await semearSessao({ role: 'profissional' });
});
afterAll(async () => { await closePools(); });

describe('nenhuma rota vaza outro tenant', () => {
  it('paciente do tenant B nao aparece na busca do tenant A', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes?termo=${encodeURIComponent(b.patientNome)}`, ...auth(a) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: { patientId: string }[] }).itens
      .map((p) => p.patientId)).not.toContain(b.patientId);
    await app.close();
  });

  it('id direto de paciente de outro tenant devolve 404 ou lista vazia, nunca dado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${b.patientId}/prontuario`, ...auth(a) });
    expect([200, 404]).toContain(r.statusCode);
    if (r.statusCode === 200) {
      expect((r.json() as { itens: unknown[] }).itens).toEqual([]);
    }
    await app.close();
  });

  it('a sonda de existencia responde NAO para identificador de outro tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/existe?kind=CPF&value=${b.patientCpf}`, ...auth(a) });
    expect(r.json()).toEqual({ existe: false });
    await app.close();
  });

  it('agendar para paciente de outro tenant e recusado, nao aceito em silencio', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(a),
      payload: { patientId: b.patientId, professionalId: a.professionalId,
                 procedureId: a.procedureId, startsAt: '2027-01-05T13:00:00.000Z' } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it('a agenda do dia do tenant A nunca traz linha do tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/dia?dia=2027-01-05', ...auth(a) });
    const fila = (r.json() as { fila: { patientId: string }[] }).fila;
    expect(fila.map((x) => x.patientId)).not.toContain(b.patientId);
    await app.close();
  });

  it('trocar o x-clinic-id para uma unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/dia?dia=2027-01-05',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });
});
