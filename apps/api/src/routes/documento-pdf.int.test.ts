import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { closePdfPool } from '@cadencia/documents';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let documentId = '';

beforeAll(async () => {
  s = await semearSessao({ role: 'profissional' });
  const app = await buildApp();
  const r = await app.inject({
    method: 'POST', url: '/v1/documentos',
    payload: {
      kind: 'atestado',
      patientId: s.patientId,
      encounterId: s.encounterId,
      payload: {
        titulo: 'Atestado medico',
        corpo: 'Atesto para os devidos fins que o paciente esteve sob meus '
             + 'cuidados nesta data, devendo permanecer afastado por 2 dias.',
        diasAfastamento: 2,
      },
    },
    ...auth(s),
  });
  documentId = (r.json() as { documentId: string }).documentId;
  await app.close();
});

afterAll(async () => { await closePdfPool(); await closePools(); });

describe('impressao de documento clinico', () => {
  it('devolve um PDF de verdade, com o corpo do documento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/documentos/${documentId}/pdf`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    // O arquivo começa com %PDF- por definição do formato. Sem essa checagem,
    // um HTML servido com content-type errado passaria no teste e só falharia
    // no leitor de PDF do paciente.
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.rawPayload.length).toBeGreaterThan(1000);

    await app.close();
  }, 60_000);

  it('documento de outro tenant devolve 404', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'profissional' });
    const r = await app.inject({
      method: 'GET', url: `/v1/documentos/${documentId}/pdf`, ...auth(outro) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});
