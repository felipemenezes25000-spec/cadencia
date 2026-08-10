import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

/**
 * Termos com vigencia FECHADA e distinta: e o unico jeito de provar que a busca
 * respeita a data do evento em vez de devolver "o que vale hoje". Os codigos sao
 * inventados de proposito (Z99.*, tabela 98) para nao colidir com carga real.
 */
beforeAll(async () => {
  s = await semearSessao({ role: 'profissional' });
  const j = jobsPool();
  await j.query(
    `INSERT INTO ref.cid10_term (codigo, descricao, capitulo, vigencia, competencia)
     VALUES ('Z99.1', 'Dependencia de respirador — texto de 2024', 21,
             daterange('2024-01-01','2026-01-01'), '202401'),
            ('Z99.1', 'Dependencia de respirador — texto revisado 2026', 21,
             daterange('2026-01-01','infinity'), '202601')
     ON CONFLICT DO NOTHING`);
  // CID-11 com codigo sintetico ('ZZ...'), fora de qualquer faixa real: o
  // catalogo de verdade vem da OMS pelo script de ingestao.
  await j.query(
    `INSERT INTO ref.cid11_term (uri, codigo, descricao, capitulo, vigencia, competencia)
     VALUES ('http://id.who.int/icd/entity/999000001', 'ZZ90',
             'Termo sintetico de teste da CID-11', '01',
             daterange('2027-01-01','infinity'), '202701')
     ON CONFLICT DO NOTHING`);
  await j.query(
    `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
     VALUES (98, '90000001', 'Consulta de teste em consultorio',
             daterange('2024-01-01','infinity'), '202401', 'inclusao')
     ON CONFLICT DO NOTHING`);
});
afterAll(async () => { await closePools(); });

describe('catalogos de referencia', () => {
  it('GET /v1/catalogos/cid busca por texto e devolve o termo vigente NA DATA', async () => {
    const app = await buildApp();

    const antigo = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid?termo=respirador&data=2025-06-01', ...auth(s) });
    const novo = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid?termo=respirador&data=2026-06-01', ...auth(s) });

    expect(antigo.statusCode).toBe(200);
    expect(novo.statusCode).toBe(200);
    const a = (antigo.json() as { itens: { codigo: string; descricao: string }[] }).itens;
    const n = (novo.json() as { itens: { codigo: string; descricao: string }[] }).itens;

    expect(a.find((x) => x.codigo === 'Z99.1')?.descricao).toContain('texto de 2024');
    expect(n.find((x) => x.codigo === 'Z99.1')?.descricao).toContain('revisado 2026');

    await app.close();
  });

  it('GET /v1/catalogos/cid acha pelo codigo, nao so pela descricao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid?termo=Z99.1&data=2026-06-01', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: { codigo: string }[] }).itens[0]?.codigo).toBe('Z99.1');
    await app.close();
  });

  it('GET /v1/catalogos/cid11 devolve a URI da fundacao junto do codigo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid11?termo=ZZ90&data=2027-06-01', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const item = (r.json() as {
      itens: { codigo: string; uri: string; capitulo: string | null;
               competencia: string }[] }).itens[0];
    expect(item?.codigo).toBe('ZZ90');
    // Sem a URI, quem grava o diagnostico so teria o codigo — que a OMS pode
    // recodificar no release seguinte, apagando o rastro da entidade.
    expect(item?.uri).toBe('http://id.who.int/icd/entity/999000001');
    // Capitulo e TEXTO na CID-11: os capitulos V e X sao letras.
    expect(item?.capitulo).toBe('01');
    expect(item?.competencia).toBe('202701');
    await app.close();
  });

  it('GET /v1/catalogos/cid11 respeita a data do evento como a CID-10', async () => {
    const app = await buildApp();
    // O termo so vale a partir de 2027, quando a CID-11 entra em uso no Brasil.
    const antes = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid11?termo=ZZ90&data=2026-06-01', ...auth(s) });
    expect((antes.json() as { itens: unknown[] }).itens).toEqual([]);
    await app.close();
  });

  it('as duas CIDs nao se misturam: buscar na 10 nao acha termo da 11', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid?termo=ZZ90&data=2027-06-01', ...auth(s) });
    expect((r.json() as { itens: unknown[] }).itens).toEqual([]);
    await app.close();
  });

  it('GET /v1/catalogos/cid SEM data e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/catalogos/cid?termo=respirador', ...auth(s) });
    // Nao existe lookup de terminologia sem data do evento (§3.9, decisao
    // irreversivel 11). Deixar `data` opcional com default de hoje e o bug que
    // so aparece meses depois, num lote rejeitado.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('GET /v1/catalogos/tuss busca por tabela e termo na data', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/catalogos/tuss?tabela=98&termo=consulta%20de%20teste&data=2026-06-01',
      ...auth(s) });
    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: { codigo: string; termo: string }[] }).itens;
    expect(itens.find((x) => x.codigo === '90000001')).toBeDefined();
    await app.close();
  });

  it('GET /v1/catalogos/tuss fora da vigencia devolve vazio, nao o termo errado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/catalogos/tuss?tabela=98&termo=consulta%20de%20teste&data=2023-06-01',
      ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: unknown[] }).itens).toHaveLength(0);
    await app.close();
  });
});

describe('versao da terminologia', () => {
  it('CID devolve a competencia — sem ela a versao selada nao sabe qual CID era', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/catalogos/cid?termo=Z99&data=2026-08-09',
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { codigo: string; competencia: string }[] }).itens;

    // `clin.diagnosis.terminology_version` e obrigatorio e existe para responder
    // "qual CID valia quando este diagnostico foi feito". Sem a competencia
    // vindo do catalogo, quem monta o payload teria que inventar a versao — e
    // versao inventada e pior do que versao ausente numa pericia.
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0]?.competencia).toMatch(/^\d{6}$/);
    await app.close();
  });
});
