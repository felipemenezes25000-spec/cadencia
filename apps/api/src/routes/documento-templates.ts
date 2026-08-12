/**
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
      `SELECT id, clinic_id, professional_id, kind, titulo, corpo,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM clin.document_template
        WHERE clinic_id = current_setting('app.clinic_id')::uuid
        ORDER BY kind, professional_id NULLS FIRST`,
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
        `INSERT INTO clin.document_template (tenant_id, clinic_id, professional_id, kind, titulo, corpo)
         VALUES (current_setting('app.tenant_id')::uuid, current_setting('app.clinic_id')::uuid, $1, $2, $3, $4)
         RETURNING id, clinic_id, professional_id, kind, titulo, corpo,
                   created_at::text AS created_at, updated_at::text AS updated_at`,
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
    if (b.titulo !== undefined) { campos.push(`titulo = $${idx++}`); valores.push(b.titulo); }
    if (b.corpo !== undefined)  { campos.push(`corpo = $${idx++}`);   valores.push(b.corpo); }
    valores.push(p.id);
    const { rows } = await tx.query(
      `UPDATE clin.document_template SET ${campos.join(', ')}
        WHERE id = $${idx} AND clinic_id = current_setting('app.clinic_id')::uuid
        RETURNING id, clinic_id, professional_id, kind, titulo, corpo,
                  created_at::text AS created_at, updated_at::text AS updated_at`,
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
      `DELETE FROM clin.document_template WHERE id = $1 AND clinic_id = current_setting('app.clinic_id')::uuid RETURNING id`,
      [p.id],
    );
    if (rows.length === 0) {
      throw Object.assign(new Error('template_nao_encontrado'), { statusCode: 404, dominio: 'template_nao_encontrado' });
    }
    return { ok: true as const };
  }));
}
