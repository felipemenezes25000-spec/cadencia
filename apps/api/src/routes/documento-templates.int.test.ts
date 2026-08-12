import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

interface Template {
  id: string;
  clinicId: string;
  professionalId: string | null;
  kind: string;
  titulo: string;
  corpo: string;
  createdAt: string;
  updatedAt: string;
}

describe('document templates', () => {
  it('lista vazia quando clinica sem templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/documentos/templates', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: unknown[] }).itens).toEqual([]);
    await app.close();
  });

  it('cria template atestado — 201', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'atestado', titulo: 'Atestado Padrao', corpo: 'Atesto que o paciente {{paciente_nome}} compareceu.' },
      ...auth(s) });
    expect(r.statusCode).toBe(201);
    const t = r.json() as Template;
    expect(t.kind).toBe('atestado');
    expect(t.titulo).toBe('Atestado Padrao');
    expect(t.corpo).toBe('Atesto que o paciente {{paciente_nome}} compareceu.');
    expect(t.professionalId).toBeNull();
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('POST com professionalId cria template especifico', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'atestado', titulo: 'Atestado do Dr.', corpo: 'Atesto.', professionalId: s.professionalId },
      ...auth(s) });
    expect(r.statusCode).toBe(201);
    const t = r.json() as Template;
    expect(t.professionalId).toBe(s.professionalId);
    await app.close();
  });

  it('segundo POST com mesmo kind+profissional retorna 409', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'atestado', titulo: 'Duplicado', corpo: 'Corpo.' },
      ...auth(s) });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { erro: string }).erro).toBe('template_duplicado');
    await app.close();
  });

  it('PUT atualiza titulo — 200', async () => {
    const app = await buildApp();
    const criar = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'declaracao_comparecimento', titulo: 'Declaracao Original', corpo: 'Corpo.' },
      ...auth(s) });
    const t = criar.json() as Template;

    const r = await app.inject({
      method: 'PUT', url: `/v1/documentos/templates/${t.id}`,
      payload: { titulo: 'Declaracao Editada' },
      ...auth(s) });
    expect(r.statusCode).toBe(200);
    const atualizado = r.json() as Template;
    expect(atualizado.titulo).toBe('Declaracao Editada');
    expect(atualizado.corpo).toBe('Corpo.');
    await app.close();
  });

  it('PUT atualiza corpo — 200', async () => {
    const app = await buildApp();
    const criar = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'pedido_exame', titulo: 'Pedido', corpo: 'Corpo antigo.' },
      ...auth(s) });
    const t = criar.json() as Template;

    const r = await app.inject({
      method: 'PUT', url: `/v1/documentos/templates/${t.id}`,
      payload: { corpo: 'Corpo novo.' },
      ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Template).corpo).toBe('Corpo novo.');
    await app.close();
  });

  it('PUT em id inexistente retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/documentos/templates/00000000-0000-0000-0000-000000000001',
      payload: { titulo: 'X' },
      ...auth(s) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE exclui template — 200', async () => {
    const app = await buildApp();
    const criar = await app.inject({
      method: 'POST', url: '/v1/documentos/templates',
      payload: { kind: 'relatorio', titulo: 'Para Excluir', corpo: 'Corpo.' },
      ...auth(s) });
    const t = criar.json() as Template;

    const r = await app.inject({
      method: 'DELETE', url: `/v1/documentos/templates/${t.id}`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { ok: boolean }).ok).toBe(true);
    await app.close();
  });

  it('DELETE template inexistente retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: '/v1/documentos/templates/00000000-0000-0000-0000-000000000001',
      ...auth(s) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('GET vars retorna lista de variaveis', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/documentos/templates/vars/atestado', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const vars = (r.json() as { variaveis: Array<{ chave: string }> }).variaveis;
    expect(vars.some(v => v.chave === 'paciente_nome')).toBe(true);
    expect(vars.some(v => v.chave === 'dias_afastamento')).toBe(true);
    expect(vars.some(v => v.chave === 'cid')).toBe(true);
    await app.close();
  });
});
