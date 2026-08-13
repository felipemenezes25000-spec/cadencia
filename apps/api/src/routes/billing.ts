import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';
import {
  listPlans,
  getSubscription,
  createSubscription,
  cancelSubscription,
  listInvoices,
  getInvoice,
  checkFeatureLimit,
  calculateSubscriptionValue,
} from '@cadencia/billing';

/**
 * Rotas de billing / comercial.
 *
 * GET  /v1/billing/plans        - lista planos ativos
 * GET  /v1/billing/subscription - assinatura atual do tenant
 * POST /v1/billing/subscription  - criar/alterar assinatura
 * PUT  /v1/billing/subscription/cancel - cancelar assinatura
 * GET  /v1/billing/invoices     - listar faturas
 * GET  /v1/billing/invoices/:id  - detalhe da fatura
 */

// ---------------------------------------------------------------------------
// Schemas de resposta
// ---------------------------------------------------------------------------

// PostgreSQL aceita UUIDs com qualquer nibble de versao. Os planos iniciais
// possuem IDs determinísticos de versao 0, portanto `z.uuid()` (que aceita
// apenas versoes RFC modernas) recusaria uma resposta válida do banco.
const UuidDoPostgres = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'UUID invalido',
);

const PlanoSchema = z.object({
  id: UuidDoPostgres,
  slug: z.string(),
  nome: z.string(),
  valorPorProfissionalCents: z.number().int(),
  periodicidade: z.enum(['mensal', 'anual']),
  features: z.array(z.string()),
  ativo: z.boolean(),
});

const AssinaturaSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  planoId: z.string().uuid(),
  status: z.enum(['trial', 'ativa', 'suspensa', 'cancelada']),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  gatewayClientId: z.string().nullable(),
  trialTerminoEm: z.string(),
  motivoSuspensao: z.string().nullable(),
  plano: PlanoSchema,
});

const FaturaSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  assinaturaId: z.string().uuid(),
  valorCents: z.number().int(),
  status: z.enum(['pendente', 'paga', 'vencida', 'cancelada']),
  dataVencimento: z.string(),
  dataPagamento: z.string().nullable(),
  linkPagamento: z.string().nullable(),
});

const ValorCalculadoSchema = z.object({
  valorCents: z.number().int(),
  profissionais: z.number().int(),
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /v1/billing/plans
  r.get('/v1/billing/plans', {
    schema: {
      response: {
        200: z.object({ itens: z.array(PlanoSchema) }),
      },
    },
  }, rota('billing.read', async (tx) => {
    const planos = await listPlans(tx as never);
    return { itens: planos };
  }));

  // GET /v1/billing/subscription
  r.get('/v1/billing/subscription', {
    schema: {
      response: {
        200: z.object({
          assinatura: AssinaturaSchema.nullable(),
          valorCalculado: ValorCalculadoSchema.nullable(),
        }),
      },
    },
  }, rota('billing.read', async (tx, ctx) => {
    const tenantId = ctx.actor.tenantId;
    const assinatura = await getSubscription(tx as never, tenantId);
    const valorCalculado = await calculateSubscriptionValue(tx as never, tenantId);
    return { assinatura, valorCalculado };
  }));

  // POST /v1/billing/subscription
  r.post('/v1/billing/subscription', {
    schema: {
      body: z.object({
        planoId: z.string().uuid(),
        gatewayClientId: z.string().optional(),
      }),
      response: {
        200: z.object({ assinatura: AssinaturaSchema }),
        404: z.object({ erro: z.literal('plano_nao_encontrado') }),
        422: z.object({ erro: z.literal('plano_inativo') }),
      },
    },
  }, rota('billing.write', async (tx, ctx, req, reply) => {
    const b = req.body as { planoId: string; gatewayClientId?: string };
    const tenantId = ctx.actor.tenantId;

    // Verifica se o plano existe e esta ativo
    const { rows: planoRows } = await tx.query<{
      id: string; ativo: boolean;
    }>(
      `SELECT id, ativo FROM com.plano WHERE id = $1`,
      [b.planoId],
    );

    if (!planoRows[0]) {
      return reply.code(404).send({ erro: 'plano_nao_encontrado' as const });
    }
    if (!planoRows[0].ativo) {
      return reply.code(422).send({ erro: 'plano_inativo' as const });
    }

    const assinatura = await createSubscription(
      tx as never,
      tenantId,
      b.planoId,
      b.gatewayClientId,
    );

    return { assinatura };
  }));

  // PUT /v1/billing/subscription/cancel
  r.put('/v1/billing/subscription/cancel', {
    schema: {
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('assinatura_nao_encontrada') }),
      },
    },
  }, rota('billing.write', async (tx, ctx) => {
    const tenantId = ctx.actor.tenantId;

    await cancelSubscription(tx as never, tenantId);

    return { ok: true as const };
  }));

  // GET /v1/billing/invoices
  r.get('/v1/billing/invoices', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      response: {
        200: z.object({
          itens: z.array(FaturaSchema),
          total: z.number().int(),
          limit: z.number().int(),
          offset: z.number().int(),
        }),
      },
    },
  }, rota('billing.read', async (tx, ctx, req) => {
    const q = req.query as { limit: number; offset: number };
    const tenantId = ctx.actor.tenantId;

    const resultado = await listInvoices(tx as never, tenantId, q.limit, q.offset);

    return {
      ...resultado,
      limit: q.limit,
      offset: q.offset,
    };
  }));

  // GET /v1/billing/invoices/:id
  r.get('/v1/billing/invoices/:id', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: FaturaSchema,
        404: z.object({ erro: z.literal('fatura_nao_encontrada') }),
      },
    },
  }, rota('billing.read', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };
    const tenantId = ctx.actor.tenantId;

    const fatura = await getInvoice(tx as never, p.id);

    if (!fatura || fatura.tenantId !== tenantId) {
      return reply.code(404).send({ erro: 'fatura_nao_encontrada' as const });
    }

    return fatura;
  }));

  // GET /v1/billing/feature/:feature
  // Verifica se uma feature esta liberada no plano atual
  r.get('/v1/billing/feature/:feature', {
    schema: {
      params: z.object({
        feature: z.string().min(1),
      }),
      response: {
        200: z.object({
          allowed: z.boolean(),
          reason: z.string().optional(),
        }),
      },
    },
  }, rota('billing.read', async (tx, ctx, req) => {
    const p = req.params as { feature: string };
    const tenantId = ctx.actor.tenantId;

    const resultado = await checkFeatureLimit(tx as never, tenantId, p.feature);

    return {
      allowed: resultado.allowed,
      reason: resultado.reason,
    };
  }));
}
