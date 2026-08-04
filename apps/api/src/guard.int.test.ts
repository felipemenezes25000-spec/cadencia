import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, type SementeSessao } from './test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

describe('RBAC na borda', () => {
  it('recepcao recebe 403 na rota clinica, com o motivo nomeado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`,
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_permissao', acao: 'encounter.read',
                              motivo: 'papel_insuficiente' });
    await app.close();
  });

  it('o 403 do authz gera evento de auditoria de acesso NEGADO', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`,
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    await app.close();
    const { rows } = await (await import('@cadencia/db')).appPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE outcome = 'negado' AND event_type = 'AUTHZ_DENY'`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
