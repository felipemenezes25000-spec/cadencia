import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchDrugs, getDrugById, getLeaflet } from '@cadencia/bulas';
import { rota } from '../guard';

const DrugSearchResultSchema = z.object({
  id: z.string().uuid(),
  registroAnvisa: z.string(),
  nome: z.string(),
  principioAtivo: z.string(),
  classeTerapeutica: z.string().nullable(),
  concentracao: z.string().nullable(),
  formaFarmaceutica: z.string().nullable(),
  fabricante: z.string().nullable(),
  tsRank: z.number(),
});

const DrugSchema = DrugSearchResultSchema.extend({
  createdAt: z.string(),
});

const LeafletSchema = z.object({
  id: z.string().uuid(),
  medicamentoId: z.string().uuid(),
  tipo: z.enum(['paciente', 'profissional']),
  conteudo: z.string(),
  versao: z.string().nullable(),
  dataPublicacao: z.string().nullable(),
  createdAt: z.string(),
});

export async function drugRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/drugs/search', {
    schema: {
      querystring: z.object({
        q: z.string().min(2, 'Mínimo 2 caracteres para buscar'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          itens: z.array(DrugSearchResultSchema),
        }),
      },
    },
  }, rota('drug.read', async (tx, _ctx, req) => {
    const q = req.query as { q: string; limit: number };
    const itens = await searchDrugs(tx, q.q, q.limit);
    return { itens };
  }));

  r.get('/v1/drugs/:id', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: DrugSchema,
        404: z.object({ erro: z.literal('nao_encontrado') }),
      },
    },
  }, rota('drug.read', async (tx, _ctx, req, reply) => {
    const { id } = req.params as { id: string };
    const drug = await getDrugById(tx, id);

    if (!drug) {
      return reply.code(404).send({ erro: 'nao_encontrado' as const });
    }

    return {
      id: drug.id,
      registroAnvisa: drug.registroAnvisa,
      nome: drug.nome,
      principioAtivo: drug.principioAtivo,
      classeTerapeutica: drug.classeTerapeutica,
      concentracao: drug.concentracao,
      formaFarmaceutica: drug.formaFarmaceutica,
      fabricante: drug.fabricante,
      tsRank: 0,
      createdAt: drug.createdAt.toISOString(),
    };
  }));

  r.get('/v1/drugs/:id/leaflet', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: z.object({
        tipo: z.enum(['paciente', 'profissional']).default('paciente'),
      }),
      response: {
        200: LeafletSchema,
        404: z.object({ erro: z.literal('nao_encontrado') }),
      },
    },
  }, rota('drug.read', async (tx, _ctx, req, reply) => {
    const { id } = req.params as { id: string };
    const { tipo } = req.query as { tipo: 'paciente' | 'profissional' };

    const leaflet = await getLeaflet(tx, id, tipo);

    if (!leaflet) {
      return reply.code(404).send({ erro: 'nao_encontrado' as const });
    }

    return {
      id: leaflet.id,
      medicamentoId: leaflet.medicamentoId,
      tipo: leaflet.tipo,
      conteudo: leaflet.conteudo,
      versao: leaflet.versao,
      dataPublicacao: leaflet.dataPublicacao?.toISOString().split('T')[0] ?? null,
      createdAt: leaflet.createdAt.toISOString(),
    };
  }));
}
