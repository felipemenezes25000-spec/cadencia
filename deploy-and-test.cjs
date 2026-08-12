#!/usr/bin/env node
// Script to create all document templates files and run tests
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const base = 'C:\\\\Users\\\\Felipe\\\\Downloads\\\\novo projeto';

function writeFile(path, content) {
  fs.writeFileSync(path, content, 'utf8');
  console.log('Written:', path);
}

// 1. Routes file
const routesContent = `/**
 * Rotas de templates de documento.
 *
 * CRUD completo de modelos de documento por clinica/profissional.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const DocumentKind = z.enum([
  'atestado', 'declaracao_comparecimento', 'pedido_exame', 'relatorio',
]);
export type DocumentKind = z.infer<typeof DocumentKind>;

const TemplateSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  professionalId: z.string().uuid().nullable(),
  kind: DocumentKind,
  titulo: z.string(),
  corpo: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TEMPLATE_VARIABLES = [
  { chave: 'paciente_nome',        exemplo: 'Maria da Silva',      descricao: 'Nome completo do paciente' },
  { chave: 'paciente_cpf',          exemplo: '123.456.789-00',     descricao: 'CPF do paciente' },
  { chave: 'paciente_nascimento',   exemplo: '15/03/1985',          descricao: 'Data de nascimento do paciente' },
  { chave: 'data',                 exemplo: '25/08/2026',          descricao: 'Data atual (DD/MM/AAAA)' },
  { chave: 'data_extenso',         exemplo: 'vinte e cinco de agosto', descricao: 'Data atual por extenso' },
  { chave: 'hora',                 exemplo: '14:30',               descricao: 'Hora atual (HH:MM)' },
  { chave: 'profissional_nome',    exemplo: 'Dr. Joao Carlos',    descricao: 'Nome do profissional' },
  { chave: 'profissional_conselho', exemplo: 'CRM',                descricao: 'Sigla do conselho' },
  { chave: 'profissional_numero',  exemplo: '123456',             descricao: 'Numero no conselho' },
  { chave: 'profissional_uf',       exemplo: 'SP',                 descricao: 'UF do conselho' },
  { chave: 'clinica_nome',         exemplo: 'Clinica Exemplo',     descricao: 'Nome da clinica' },
  { chave: 'dias_afastamento',     exemplo: '3',                  descricao: 'Dias de afastamento' },
  { chave: 'cid',                  exemplo: 'J06.9',              descricao: 'Codigo CID' },
] as const;

export async function documentTemplateRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/documentos/templates', {
    schema: { response: { 200: z.object({ itens: z.array(TemplateSchema) }) } },
  }, rota('document_template.read', async (tx) => {
    const { rows } = await tx.query(
      \`SELECT id, clinic_id, professional_id, kind, titulo, corpo,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM clin.document_template
        WHERE clinic_id = current_setting('app.clinic_id')::uuid
        ORDER BY kind, professional_id NULLS FIRST\`,
    );
    return { itens: rows.map((x) => ({
      id: x.id, clinicId: x.clinic_id, professionalId: x.professional_id,
      kind: x.kind, titulo: x.titulo, corpo: x.corpo,
      createdAt: String(x.created_at), updatedAt: String(x.updated_at),
    })) };
  }));

  r.get('/v1/documentos/templates/vars/:kind', {
    schema: { params: z.object({ kind: DocumentKind }) },
  }, async () => ({
    variaveis: TEMPLATE_VARIABLES.map((v) => ({
      chave: v.chave, exemplo: v.exemplo, descricao: v.descricao,
    })),
  }));

  r.post('/v1/documentos/templates', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid().nullable().optional(),
        kind: DocumentKind, titulo: z.string().min(1).max(200), corpo: z.string().min(1),
      }),
      response: { 201: TemplateSchema, 409: z.object({ erro: z.literal('template_duplicado') }) },
    },
  }, rota('document_template.write', async (tx, _ctx, req, reply) => {
    const b = req.body as { professionalId?: string; kind: string; titulo: string; corpo: string };
    try {
      const { rows } = await tx.query(
        \`INSERT INTO clin.document_template (clinic_id, professional_id, kind, titulo, corpo)
         VALUES (current_setting('app.clinic_id')::uuid, \$1, \$2, \$3, \$4)
         RETURNING id, clinic_id, professional_id, kind, titulo, corpo,
                   created_at::text AS created_at, updated_at::text AS updated_at\`,
        [b.professionalId ?? null, b.kind, b.titulo, b.corpo],
      );
      void reply.code(201);
      const x = rows[0]!;
      return {
        id: x.id, clinicId: x.clinic_id, professionalId: x.professional_id,
        kind: x.kind, titulo: x.titulo, corpo: x.corpo,
        createdAt: String(x.created_at), updatedAt: String(x.updated_at),
      };
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505') {
        return reply.code(409).send({ erro: 'template_duplicado' as const }) as never;
      }
      throw e;
    }
  }));

  r.put('/v1/documentos/templates/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ titulo: z.string().min(1).max(200).optional(), corpo: z.string().min(1).optional() }),
      response: { 200: TemplateSchema, 404: z.object({ erro: z.literal('template_nao_encontrado') }) },
    },
  }, rota('document_template.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { titulo?: string; corpo?: string };
    const campos = ['updated_at = now()'];
    const valores = [];
    let idx = 1;
    if (b.titulo !== undefined) { campos.push(\`titulo = \$\${idx++}\`); valores.push(b.titulo); }
    if (b.corpo !== undefined)  { campos.push(\`corpo = \$\${idx++}\`);   valores.push(b.corpo); }
    valores.push(p.id);
    const { rows } = await tx.query(
      \`UPDATE clin.document_template SET \${campos.join(', ')}
        WHERE id = \$\${idx} AND clinic_id = current_setting('app.clinic_id')::uuid
        RETURNING id, clinic_id, professional_id, kind, titulo, corpo,
                  created_at::text AS created_at, updated_at::text AS updated_at\`,
      valores,
    );
    if (rows[0] === undefined) {
      throw Object.assign(new Error('template_nao_encontrado'), { statusCode: 404, dominio: 'template_nao_encontrado' });
    }
    const x = rows[0]!;
    return {
      id: x.id, clinicId: x.clinic_id, professionalId: x.professional_id,
      kind: x.kind, titulo: x.titulo, corpo: x.corpo,
      createdAt: String(x.created_at), updatedAt: String(x.updated_at),
    };
  }));

  r.delete('/v1/documentos/templates/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: z.object({ erro: z.literal('template_nao_encontrado') }) },
    },
  }, rota('document_template.delete', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{ id: string }>(
      \`DELETE FROM clin.document_template WHERE id = \$1 AND clinic_id = current_setting('app.clinic_id')::uuid RETURNING id\`,
      [p.id],
    );
    if (rows.length === 0) {
      throw Object.assign(new Error('template_nao_encontrado'), { statusCode: 404, dominio: 'template_nao_encontrado' });
    }
    return { ok: true as const };
  }));
}
`;

const routesPath = base + '/apps/api/src/routes/documento-templates.ts';
writeFile(routesPath, routesContent);

// 2. Test file
const testContent = `import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      method: 'PUT', url: \`/v1/documentos/templates/\${t.id}\`,
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
      method: 'PUT', url: \`/v1/documentos/templates/\${t.id}\`,
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
      method: 'DELETE', url: \`/v1/documentos/templates/\${t.id}\`, ...auth(s) });
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
`;

const testPath = base + '/apps/api/src/routes/documento-templates.int.test.ts';
writeFile(testPath, testContent);

console.log('\n=== Files created. Running tests ===\n');

// Run vitest
const vitest = spawn('pnpm', ['test:int', '--', '--run', 'documento-templates'], {
  cwd: base,
  stdio: 'inherit',
});

vitest.on('exit', (code) => {
  console.log('\n=== Vitest finished with code:', code, '===');
  process.exit(code || 0);
});
