import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { closePdfPool } from '@cadencia/documents';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); await closePdfPool(); });

describe('artefatos clinicos', () => {
  it('POST /v1/documentos emite atestado assinado', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/documentos', ...auth(s),
      payload: { kind: 'atestado', patientId: s.patientId,
                 payload: { texto: 'Atesto para os devidos fins', diasAfastamento: 2 } } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ assinatura: { estado: 'assinado' } });
    await app.close();
  });

  it('GET /v1/pacientes/:id/documentos lista os documentos emitidos do paciente', async () => {
    const app = await buildApp();
    const emitido = await app.inject({ method: 'POST', url: '/v1/documentos', ...auth(s),
      payload: { kind: 'relatorio', patientId: s.patientId,
                 payload: { titulo: 'Relatorio de acompanhamento', corpo: 'Evolucao estavel.' } } });
    expect(emitido.statusCode).toBe(201);
    const { documentId } = emitido.json() as { documentId: string };

    const listado = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/documentos`, ...auth(s) });

    expect(listado.statusCode).toBe(200);
    expect(listado.json()).toMatchObject({
      itens: expect.arrayContaining([
        expect.objectContaining({
          documentId,
          kind: 'relatorio',
          titulo: 'Relatorio de acompanhamento',
          assinado: true,
        }),
      ]),
    });
    await app.close();
  });

  it('POST /v1/prescricoes/sessao devolve a sessao embutida do prescritor', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/prescricoes/sessao', ...auth(s),
      payload: { encounterId: s.encounterId, patientId: s.patientId } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mode: 'embedded' });
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/prescricoes confirma a partir do id devolvido pelo evento JS', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/prescricoes', ...auth(s),
      payload: { providerPrescriptionId: 'rx-1', encounterId: s.encounterId,
                 patientId: s.patientId } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ itens: 1 });
    await app.close();
  });

  it('POST /v1/pacientes/:id/exportacoes devolve o PDF e registra a entidade', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/pacientes/${s.patientId}/exportacoes`, ...auth(s),
      payload: { requesterKind: 'titular' } });
    expect(r.statusCode).toBe(201);
    const b = r.json() as { exportId: string; pageCount: number; pdfSha256Hex: string };
    expect(b.pageCount).toBeGreaterThan(0);
    expect(b.pdfSha256Hex).toHaveLength(64);
    await app.close();
  });

  it('a exportacao exige MFA — o catalogo marca requiresMfa e a borda respeita', async () => {
    const semMfa = await semearSessao({ role: 'profissional', comMfa: false });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/pacientes/${semMfa.patientId}/exportacoes`, ...auth(semMfa),
      payload: { requesterKind: 'titular' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ motivo: 'mfa_exigida' });
    await app.close();
  });
});
