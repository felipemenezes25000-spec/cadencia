import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
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
  it('recebe o arquivo, guarda e devolve o hash conferivel', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/anexos', payload: corpo(), ...auth(s) });

    expect(r.statusCode).toBe(201);
    const a = r.json() as {
      attachmentId: string; sha256: string; sizeBytes: number };
    expect(a.sizeBytes).toBe(PDF.length);
    // O hash é calculado no SERVIDOR, sobre os bytes que chegaram. Aceitar um
    // hash enviado pelo cliente seria aceitar a afirmação de quem envia sobre o
    // próprio arquivo — e o anexo é prova clínica.
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);

    await app.close();
  });

  it('lista os anexos do paciente com nome, tipo e tamanho', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/anexos`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      attachmentId: string; originalName: string; kind: string;
      sizeBytes: number; contentType: string }[] }).itens;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0]?.originalName).toBe('hemograma.pdf');
    expect(itens[0]?.sizeBytes).toBe(PDF.length);

    await app.close();
  });

  it('baixa o arquivo com o content-type que foi declarado', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/anexos`, ...auth(s) });
    const id = (lista.json() as { itens: { attachmentId: string }[] })
      .itens[0]?.attachmentId;

    const r = await app.inject({
      method: 'GET', url: `/v1/anexos/${id}/conteudo`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    // Byte a byte igual ao que subiu: anexo que volta diferente do que entrou
    // não serve como prova de nada.
    expect(Buffer.from(r.rawPayload).equals(PDF)).toBe(true);

    await app.close();
  });

  it('arquivo vazio e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/anexos',
      payload: corpo({ conteudoBase64: '' }), ...auth(s) });
    // CHECK (size_bytes > 0) no banco. Recusar aqui devolve erro de validação
    // em vez de 500 vindo do Postgres.
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

  it('recepcao NAO le anexo clinico', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${recepcao.patientId}/anexos`,
      ...auth(recepcao) });
    // Resultado de exame é dado clínico. Quem agenda não precisa dele.
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
