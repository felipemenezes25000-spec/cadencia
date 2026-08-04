import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao; let apptId = '';
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

describe('rotas de agenda', () => {
  it('POST /v1/agenda/agendamentos agenda e devolve 201', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(s),
      payload: { patientId: s.patientId, professionalId: s.professionalId,
                 procedureId: s.procedureId, startsAt: '2026-12-01T13:00:00.000Z' } });
    expect(r.statusCode).toBe(201);
    apptId = (r.json() as { appointmentId: string }).appointmentId;
    await app.close();
  });

  it('conflito devolve 409 e diz que o encaixe e possivel', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/agenda/agendamentos', ...auth(s),
      payload: { patientId: s.patientId, professionalId: s.professionalId,
                 procedureId: s.procedureId, startsAt: '2026-12-01T13:15:00.000Z' } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ erro: 'horario_ocupado', encaixePossivel: true });
    await app.close();
  });

  it('GET /v1/agenda/dia devolve contadores e fila na mesma resposta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/agenda/dia?dia=2026-12-01', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { contadores: { agendados: number }; fila: unknown[] };
    expect(b.contadores.agendados).toBe(1);
    expect(b.fila).toHaveLength(1);
    await app.close();
  });

  it('POST /v1/agenda/agendamentos/:id/checkin promove para aguardando', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/agenda/agendamentos/${apptId}/checkin`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'aguardando' });
    await app.close();
  });

  it('PATCH move o agendamento e devolve a nova data no fuso da clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PATCH', url: `/v1/agenda/agendamentos/${apptId}`, ...auth(s),
      payload: { startsAt: '2026-12-03T02:30:00.000Z' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ appointmentDate: '2026-12-02' });
    await app.close();
  });

  it('GET /v1/agenda/precisa-de-voce devolve as cinco filas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/agenda/precisa-de-voce', ...auth(s) });
    expect(Object.keys(r.json() as object)).toEqual([
      'confirmacoesSemResposta', 'prescricoesNaoAssinadas', 'resultadosChegados',
      'rascunhosDeOntem', 'guiasAFaturar']);
    await app.close();
  });
});
