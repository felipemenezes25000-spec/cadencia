import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

async function semearVariedade(t: SementeSessao): Promise<void> {
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    const linhas: readonly [string, string, string | null, string | null][] = [
      ['Zulmira Antunes Vaz',  'completo',   null, null],
      ['Amanda Beltrao Cruz',  'completo',   null, null],
      ['Inativo Silva',        'completo',   'clock_timestamp()', null],
      ['Falecido Souza',       'completo',   null, 'clock_timestamp()'],
      ['Preliminar Lima',      'preliminar', null, null],
    ];
    for (const [nome, status, inativo, obito] of linhas) {
      await admin.query(
        `INSERT INTO clin.patient
           (tenant_id, id, full_name, cadastro_status, birth_date,
            inactivated_at, deceased_at)
         VALUES ($1, $2, $3, $4, '1988-03-12',
                 ${inativo ?? 'NULL'}, ${obito ?? 'NULL'})`,
        [t.tenantId, uuidv7(), nome, status]);
    }
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  await semearVariedade(s);
});
afterAll(async () => { await closePools(); });

describe('listagem de pacientes', () => {
  it('GET /v1/pacientes/lista devolve os ativos SEM exigir termo de busca', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/pacientes/lista', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const nomes = (r.json() as { itens: { displayName: string }[] })
      .itens.map((x) => x.displayName);

    // A tela de Pacientes e uma LISTA, nao um combobox: chegar nela e ver a base
    // vazia ate digitar algo faz o produto parecer quebrado.
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes).toContain('Amanda Beltrao Cruz');
    expect(nomes).not.toContain('Inativo Silva');
    expect(nomes).not.toContain('Falecido Souza');

    await app.close();
  });

  it('ordena por nome no collation pt-BR: acento nao joga o paciente para o fim', async () => {
    const app = await buildApp();
    const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    await admin.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Alvaro Acentuado', 'completo')`, [s.tenantId, uuidv7()]);
    await admin.end();

    const r = await app.inject({ method: 'GET', url: '/v1/pacientes/lista', ...auth(s) });
    const nomes = (r.json() as { itens: { displayName: string }[] })
      .itens.map((x) => x.displayName);

    // Sob C.UTF-8 puro, 'Alvaro' com acento cairia depois de 'Zulmira' (§10.19).
    expect(nomes.indexOf('Alvaro Acentuado')).toBeLessThan(nomes.indexOf('Zulmira Antunes Vaz'));

    await app.close();
  });

  it('cada faceta traz o seu proprio recorte', async () => {
    const app = await buildApp();

    const inativos = await app.inject({
      method: 'GET', url: '/v1/pacientes/lista?faceta=inativos', ...auth(s) });
    const obitos = await app.inject({
      method: 'GET', url: '/v1/pacientes/lista?faceta=obitos', ...auth(s) });
    const preliminares = await app.inject({
      method: 'GET', url: '/v1/pacientes/lista?faceta=cadastro_preliminar', ...auth(s) });

    const nomes = (r: typeof inativos) =>
      (r.json() as { itens: { displayName: string }[] }).itens.map((x) => x.displayName);

    expect(nomes(inativos)).toContain('Inativo Silva');
    expect(nomes(obitos)).toContain('Falecido Souza');
    expect(nomes(preliminares)).toContain('Preliminar Lima');
    expect(nomes(preliminares)).not.toContain('Amanda Beltrao Cruz');

    await app.close();
  });

  it('o termo estreita a lista sem trocar de faceta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/pacientes/lista?termo=amanda', ...auth(s) });
    const nomes = (r.json() as { itens: { displayName: string }[] })
      .itens.map((x) => x.displayName);
    expect(nomes).toEqual(['Amanda Beltrao Cruz']);
    await app.close();
  });
});
