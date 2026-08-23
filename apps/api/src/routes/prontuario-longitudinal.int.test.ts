import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, type SementeSessao } from '../test-support';

let profissional: SementeSessao;
let recepcao: SementeSessao;

beforeAll(async () => {
  profissional = await semearSessao({ role: 'profissional' });
  recepcao = await semearSessao({ role: 'recepcao' });
});
afterAll(async () => { await closePools(); });

function auth(s: SementeSessao) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

describe('prontuário longitudinal', () => {
  it('devolve timeline clínica enriquecida para profissional', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/${profissional.patientId}/prontuario-longitudinal`,
      ...auth(profissional),
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<Record<string, unknown>> };
    expect(Array.isArray(body.itens)).toBe(true);
    if (body.itens[0] !== undefined) {
      expect(body.itens[0]).toMatchObject({
        encounterId: expect.any(String),
        occurredDate: expect.any(String),
        profissionalNome: expect.any(String),
        versionCount: expect.any(Number),
        diagnosticos: expect.any(Array),
        sinaisVitais: expect.any(Array),
        achados: expect.any(Array),
        prescricoes: expect.any(Number),
        documentos: expect.any(Number),
        examesSolicitados: expect.any(Number),
        resultadosExames: expect.any(Number),
      });
    }
    await app.close();
  });

  it('mantém prontuário clínico fora do alcance da recepção', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/${recepcao.patientId}/prontuario-longitudinal`,
      ...auth(recepcao),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
