import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';
import type { TxClient } from '@cadencia/db';

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const DataDoEvento = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const CatalogoIndisponivel = z.object({
  erro: z.literal('catalogo_nao_carregado'),
  catalogo: z.enum(['CID10', 'CID11', 'CIAP2', 'SIGTAP']),
});

const TABELAS = {
  CID10: 'ref.cid10_term', CID11: 'ref.cid11_term',
  CIAP2: 'ref.ciap2_term', SIGTAP: 'ref.sigtap_procedure',
} as const;

async function exigirCatalogo(
  tx: TxClient, catalogo: keyof typeof TABELAS,
  reply: { code(status: number): { send(body: unknown): unknown } },
): Promise<boolean> {
  const { rows } = await tx.query<{ carregado: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${TABELAS[catalogo]} LIMIT 1) AS carregado`);
  if (rows[0]?.carregado) return true;
  void reply.code(503).send({ erro: 'catalogo_nao_carregado', catalogo });
  return false;
}

export async function catalogoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/catalogos/cid', {
    schema: { querystring: z.object({ termo: z.string().min(2), data: DataDoEvento, limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional() }),
      response: { 200: z.object({ itens: z.array(z.object({ codigo: z.string(), descricao: z.string(), capitulo: z.number().int().nullable(), competencia: z.string() })) }), 503: CatalogoIndisponivel } },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'CID10', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{ codigo: string; descricao: string; capitulo: number | null; competencia: string }>(
      `SELECT codigo, descricao, capitulo, competencia FROM ref.cid10_term
        WHERE vigencia @> $2::date AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));

  r.get('/v1/catalogos/cid11', {
    schema: { querystring: z.object({ termo: z.string().min(2), data: DataDoEvento, limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional() }),
      response: { 200: z.object({ itens: z.array(z.object({ codigo: z.string(), descricao: z.string(), capitulo: z.string().nullable(), uri: z.string(), competencia: z.string() })) }), 503: CatalogoIndisponivel } },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'CID11', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{ codigo: string; descricao: string; capitulo: string | null; uri: string; competencia: string }>(
      `SELECT codigo, descricao, capitulo, uri, competencia FROM ref.cid11_term
        WHERE vigencia @> $2::date AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));

  r.get('/v1/catalogos/ciap2', {
    schema: { querystring: z.object({ termo: z.string().min(1), data: DataDoEvento, limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional() }),
      response: { 200: z.object({ itens: z.array(z.object({ codigo: z.string(), descricao: z.string(), capitulo: z.string().nullable(), competencia: z.string() })) }), 503: CatalogoIndisponivel } },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'CIAP2', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{ codigo: string; descricao: string; capitulo: string | null; competencia: string }>(
      `SELECT codigo, descricao, capitulo, competencia FROM ref.ciap2_term
        WHERE vigencia @> $2::date AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows };
  }));

  r.get('/v1/catalogos/sigtap', {
    schema: { querystring: z.object({ termo: z.string().min(1), data: DataDoEvento, limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional() }),
      response: { 200: z.object({ itens: z.array(z.object({ codigo: z.string(), descricao: z.string(), grupo: z.string().nullable(), subgrupo: z.string().nullable(), formaOrganizacao: z.string().nullable(), competencia: z.string() })) }), 503: CatalogoIndisponivel } },
  }, rota('catalog.read', async (tx, _ctx, req, reply) => {
    if (!await exigirCatalogo(tx, 'SIGTAP', reply)) return;
    const q = req.query as { termo: string; data: string; limit?: number };
    const { rows } = await tx.query<{
      codigo: string; descricao: string; grupo: string | null; subgrupo: string | null;
      forma_organizacao: string | null; competencia: string;
    }>(
      `SELECT codigo, descricao, grupo, subgrupo, forma_organizacao, competencia
         FROM ref.sigtap_procedure
        WHERE vigencia @> $2::date AND (codigo ILIKE $1 || '%' OR descricao ILIKE '%' || $1 || '%')
        ORDER BY (codigo ILIKE $1 || '%') DESC, codigo LIMIT $3`,
      [q.termo, q.data, q.limit ?? LIMITE_PADRAO]);
    return { itens: rows.map((x) => ({
      codigo: x.codigo, descricao: x.descricao, grupo: x.grupo, subgrupo: x.subgrupo,
      formaOrganizacao: x.forma_organizacao, competencia: x.competencia,
    })) };
  }));
}
