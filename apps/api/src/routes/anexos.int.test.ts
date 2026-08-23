import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let pedidoId: string;

beforeAll(async () => {
  s = await semearSessao({ role: 'profissional' });
  const app = await buildApp();
  const pedido = await app.inject({
    method: 'POST',
    url: '/v1/documentos',
    payload: {
      kind: 'pedido_exame',
      patientId: s.patientId,
      encounterId: s.encounterId,
      payload: { titulo: 'Hemograma completo', corpo: 'Solicito hemograma completo.' },
    },
    ...auth(s),
  });
  expect(pedido.statusCode).toBe(201);
  pedidoId = (pedido.json() as { documentId: string }).documentId;
  await app.close();
});
afterAll(async () => { await closePools(); });

const PDF = Buffer.from('%PDF-1.4\nexame de sangue simulado\n%%EOF');

function corpo(over: Record<string, unknown> = {}) {
  return {
    patientId: s.patientId,
    encounterId: s.encounterId,
    kind: 'resultado_exame',
    originalName: 'hemograma.pdf',
    contentType: 'application/pdf',
    conteudoBase64: PDF.toString('base64'),
    ...over,
  };
}

describe('anexos do prontuario', () => {
  it('lista pedido de exame pendente antes de o resultado chegar', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/${s.patientId}/pedidos-exame?pendentes=true`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: { documentId: string }[] }).itens)
      .toEqual(expect.arrayContaining([expect.objectContaining({ documentId: pedidoId })]));
    await app.close();
  });

  it('recebe resultado, vincula ao pedido e devolve o hash conferivel', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/anexos',
      payload: corpo({ requestDocumentId: pedidoId }), ...auth(s) });

    expect(r.statusCode).toBe(201);
    const a = r.json() as {
      attachmentId: string; sha256: string; sizeBytes: number;
      requestDocumentId: string | null };
    expect(a.sizeBytes).toBe(PDF.length);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.requestDocumentId).toBe(pedidoId);
    await app.close();
  });

  it('pedido deixa de ser pendente depois do resultado vinculado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pacientes/${s.patientId}/pedidos-exame?pendentes=true`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: { documentId: string }[] }).itens
      .some((x) => x.documentId === pedidoId)).toBe(false);
    await app.close();
  });

  it('recusa vincular resultado a pedido de outro paciente', async () => {
    const outro = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/anexos',
      payload: {
        ...corpo({ patientId: outro.patientId, encounterId: outro.encounterId }),
        requestDocumentId: pedidoId,
      },
      ...auth(outro),
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it('lista os anexos com o pedido que originou o resultado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/anexos`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      attachmentId: string; originalName: string; kind: string; sizeBytes: number;
      contentType: string; requestDocumentId: string | null; pedidoTitulo: string | null }[] }).itens;
    const hemograma = itens.find((x) => x.originalName === 'hemograma.pdf');
    expect(hemograma?.sizeBytes).toBe(PDF.length);
    expect(hemograma?.requestDocumentId).toBe(pedidoId);
    expect(hemograma?.pedidoTitulo).toBe('Hemograma completo');

    await app.close();
  });

  it('baixa o arquivo com o content-type que foi declarado', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/anexos`, ...auth(s) });
    const id = (lista.json() as { itens: { attachmentId: string; originalName: string }[] })
      .itens.find((x) => x.originalName === 'hemograma.pdf')?.attachmentId;

    const r = await app.inject({
      method: 'GET', url: `/v1/anexos/${id}/conteudo`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(r.rawPayload).equals(PDF)).toBe(true);

    await app.close();
  });

  it('arquivo vazio e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/anexos',
      payload: corpo({ conteudoBase64: '' }), ...auth(s) });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('anexo de outro tenant nao aparece nem baixa', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/anexos`, ...auth(s) });
    const id = (lista.json() as { itens: { attachmentId: string }[] })
      .itens[0]?.attachmentId;

    const outro = await semearSessao({ role: 'profissional' });
    const r = await app.inject({
      method: 'GET', url: `/v1/anexos/${id}/conteudo`, ...auth(outro) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('recepcao NAO le anexo clinico nem pedidos de exame', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const [anexos, pedidos] = await Promise.all([
      app.inject({
        method: 'GET', url: `/v1/pacientes/${recepcao.patientId}/anexos`, ...auth(recepcao) }),
      app.inject({
        method: 'GET', url: `/v1/pacientes/${recepcao.patientId}/pedidos-exame`, ...auth(recepcao) }),
    ]);
    expect(anexos.statusCode).toBe(403);
    expect(pedidos.statusCode).toBe(403);
    await app.close();
  });
});
