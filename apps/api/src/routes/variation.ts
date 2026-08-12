import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  computeVariation, drillDownFactor,
  readVariationSnapshot,
} from '@cadencia/reports';
import { rota } from '../guard';

const VariationQuerySchema = z.object({
  clinic_id: z.string().uuid(),
  period_a_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_a_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force_recompute: z.enum(['true', 'false']).optional().default('false'),
});

const DrillDownQuerySchema = z.object({
  clinic_id: z.string().uuid(),
  factor: z.enum([
    'volume', 'mix_procedimento', 'mix_convenio',
    'ticket', 'faltas', 'glosas',
  ]),
  period_a_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_a_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function variationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /v1/variation
   *
   * Retorna a decomposição de variação de receita entre dois períodos.
   * Tenta ler do snapshot persistido. Se não existir ou force_recompute=true,
   * computa ao vivo e retorna sem persistir (persistência é responsabilidade
   * do worker/job).
   */
  r.get('/v1/variation', {
    schema: { querystring: VariationQuerySchema },
  }, rota('report.variation.read', async (tx, ctx, req) => {
    const q = req.query as z.infer<typeof VariationQuerySchema>;
    const periodA = { start: q.period_a_start, end: q.period_a_end };
    const periodB = { start: q.period_b_start, end: q.period_b_end };

    // Tenta ler snapshot cached
    if (q.force_recompute !== 'true') {
      const cached = await readVariationSnapshot(
        tx, ctx.actor.tenantId, q.clinic_id, periodA, periodB,
      );
      if (cached !== null) {
        return {
          source: 'cached' as const,
          tenant_id: cached.tenantId,
          clinic_id: cached.clinicId,
          period_a: cached.periodA,
          period_b: cached.periodB,
          computed_at: cached.computedAt,
          factors: cached.factors,
        };
      }
    }

    // Computa ao vivo
    const computed = await computeVariation(
      tx, ctx.actor.tenantId, q.clinic_id, periodA, periodB,
    );
    return {
      source: 'computed' as const,
      tenant_id: computed.tenantId,
      clinic_id: computed.clinicId,
      period_a: computed.periodA,
      period_b: computed.periodB,
      computed_at: computed.computedAt,
      factors: computed.factors,
    };
  }));

  /**
   * GET /v1/variation/drill-down
   *
   * Retorna o detalhamento de um fator especifico da decomposicao,
   * agrupado por profissional, dia da semana e faixa de horario.
   */
  r.get('/v1/variation/drill-down', {
    schema: { querystring: DrillDownQuerySchema },
  }, rota('report.variation.read', async (tx, ctx, req) => {
    const q = req.query as z.infer<typeof DrillDownQuerySchema>;
    const periodA = { start: q.period_a_start, end: q.period_a_end };
    const periodB = { start: q.period_b_start, end: q.period_b_end };

    return drillDownFactor(
      tx, ctx.actor.tenantId, q.clinic_id, q.factor, periodA, periodB,
    );
  }));
}
