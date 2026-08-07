// apps/api/src/routes/repasse.ts
//
// Rotas de repasse medico: regras, calculo, extrato e pagamento.
//
// DIVERGENCIA: o plano original usava action keys split_rule.write,
// split_rule.read, repasse.read, repasse.close, repasse.pay, mas o catalogo
// de authz real (packages/authz/src/actions.ts) define finance.settings
// para CRUD de regras de split e finance.repasse para operacoes de repasse.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createSplitRule, type CreateSplitRuleInput } from '@cadencia/payments';
import { closeRepassePeriod, payRepasse } from '@cadencia/payments';
import { rota } from '../guard';

export async function repasseRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- POST /v1/split-rules — criar regra de repasse --------------------------
  r.post('/v1/split-rules', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        conventionName: z.string().min(1).optional(),
        percentage: z.number().min(0).max(100).optional(),
        fixedAmountCents: z.number().int().min(1).optional(),
        priority: z.number().int().min(1).default(1),
      }),
      response: {
        201: z.object({ ruleId: z.string().uuid() }),
      },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; procedureId?: string; conventionName?: string;
      percentage?: number; fixedAmountCents?: number; priority: number };

    const input: CreateSplitRuleInput = {
      professionalId: b.professionalId,
      priority: b.priority,
      ...(b.procedureId !== undefined && { procedureId: b.procedureId }),
      ...(b.conventionName !== undefined && { conventionName: b.conventionName }),
      ...(b.percentage !== undefined && { percentage: b.percentage }),
      ...(b.fixedAmountCents !== undefined && { fixedAmountCents: b.fixedAmountCents }),
    };

    const result = await createSplitRule(tx, input);

    if (!result.ok) {
      const status = result.error.kind === 'profissional_nao_encontrado' ? 404 : 422;
      throw Object.assign(new Error(result.error.kind),
        { statusCode: status, dominio: result.error.kind });
    }

    void reply.code(201);
    return { ruleId: result.value.ruleId };
  }));

  // -- GET /v1/split-rules — listar regras de repasse -------------------------
  r.get('/v1/split-rules', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          rules: z.array(z.object({
            id: z.string().uuid(),
            professionalId: z.string().uuid(),
            procedureId: z.string().uuid().nullable(),
            conventionName: z.string().nullable(),
            percentage: z.number().nullable(),
            fixedAmountCents: z.number().nullable(),
            priority: z.number(),
            active: z.boolean(),
          })),
        }),
      },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      conditions.push(`professional_id = $${idx}`);
      params.push(q.professionalId);
      idx += 1;
    }

    const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; procedure_id: string | null;
      convention_name: string | null; percentage: string | null;
      fixed_amount_cents: string | null; priority: number; active: boolean;
    }>(
      `SELECT id::text, professional_id::text, procedure_id::text,
              convention_name, percentage::text, fixed_amount_cents::text,
              priority, active
         FROM fin.split_rule
        WHERE active = true ${where}
        ORDER BY priority DESC`,
      params);

    return {
      rules: rows.map((row) => ({
        id: row.id,
        professionalId: row.professional_id,
        procedureId: row.procedure_id,
        conventionName: row.convention_name,
        percentage: row.percentage !== null ? Number(row.percentage) : null,
        fixedAmountCents: row.fixed_amount_cents !== null
          ? Number(row.fixed_amount_cents) : null,
        priority: row.priority,
        active: row.active,
      })),
    };
  }));

  // -- GET /v1/repasse/statements — listar extratos de repasse ----------------
  r.get('/v1/repasse/statements', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
        status: z.enum(['aberto', 'fechado', 'pago']).optional(),
      }),
      response: {
        200: z.object({
          statements: z.array(z.object({
            id: z.string().uuid(),
            professionalId: z.string().uuid(),
            professionalName: z.string(),
            clinicId: z.string().uuid(),
            periodStart: z.string(),
            periodEnd: z.string(),
            totalEntries: z.number(),
            totalProfessionalShare: z.number(),
            totalClinicShare: z.number(),
            status: z.string(),
            paidAt: z.string().nullable(),
          })),
        }),
      },
    },
  }, rota('finance.repasse', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string; status?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      conditions.push(`rs.professional_id = $${idx}`);
      params.push(q.professionalId);
      idx += 1;
    }
    if (q.status !== undefined) {
      conditions.push(`rs.status = $${idx}::fin.repasse_statement_status`);
      params.push(q.status);
      idx += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; professional_name: string;
      clinic_id: string; period_start: string; period_end: string;
      total_entries: number; total_professional_share: string;
      total_clinic_share: string; status: string; paid_at: string | null;
    }>(
      `SELECT rs.id::text, rs.professional_id::text,
              u.full_name AS professional_name,
              rs.clinic_id::text,
              rs.period_start::text, rs.period_end::text,
              rs.total_entries, rs.total_professional_share::text,
              rs.total_clinic_share::text, rs.status::text,
              to_char(rs.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
         FROM fin.repasse_statement rs
         JOIN app.professional p
           ON p.tenant_id = rs.tenant_id AND p.id = rs.professional_id
         JOIN id."user" u ON u.id = p.user_id
         ${where}
        ORDER BY rs.period_start DESC`,
      params);

    return {
      statements: rows.map((row) => ({
        id: row.id,
        professionalId: row.professional_id,
        professionalName: row.professional_name,
        clinicId: row.clinic_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        totalEntries: row.total_entries,
        totalProfessionalShare: Number(row.total_professional_share),
        totalClinicShare: Number(row.total_clinic_share),
        status: row.status,
        paidAt: row.paid_at,
      })),
    };
  }));

  // -- POST /v1/repasse/close — fechar periodo de repasse ---------------------
  r.post('/v1/repasse/close', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        201: z.object({
          statementId: z.string().uuid(),
          totalEntries: z.number(),
          totalProfessionalShare: z.number(),
          totalClinicShare: z.number(),
        }),
      },
    },
  }, rota('finance.repasse', async (tx, ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; periodStart: string; periodEnd: string };

    const result = await closeRepassePeriod(tx, {
      tenantId: ctx.actor.tenantId,
      professionalId: b.professionalId,
      clinicId: ctx.actor.clinicId,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
    });

    if (!result.ok) {
      throw Object.assign(new Error(result.error.kind),
        { statusCode: 422, dominio: result.error.kind });
    }

    void reply.code(201);
    return result.value;
  }));

  // -- POST /v1/repasse/:id/pay — marcar extrato como pago --------------------
  r.post('/v1/repasse/:id/pay', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          statementId: z.string().uuid(),
          status: z.literal('pago'),
        }),
      },
    },
  }, rota('finance.repasse', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const result = await payRepasse(tx, { statementId: p.id });

    if (!result.ok) {
      const status = result.error.kind === 'extrato_nao_encontrado' ? 404 : 422;
      throw Object.assign(new Error(result.error.kind),
        { statusCode: status, dominio: result.error.kind });
    }

    return { statementId: result.value.statementId, status: 'pago' as const };
  }));
}
