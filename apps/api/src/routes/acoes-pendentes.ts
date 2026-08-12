import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * As três ações que as telas já ofereciam e que o backend não servia.
 *
 * Duas quitações e o quebra-vidro. As três compartilham uma propriedade: o
 * carimbo de tempo vem do BANCO (`clock_timestamp()`), nunca do cliente. Quem
 * decide em que dia uma despesa entrou no caixa não pode ser o relógio do
 * navegador de quem clicou.
 */

const Quitacao = z.object({
  status: z.literal('pago'),
  pagoEm: z.string(),
});

export async function acoesPendentesRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Quitar despesa. IDEMPOTENTE de propósito: a recepção clica duas vezes
   * quando a rede demora, e a segunda tem que ser inofensiva. O `WHERE` filtra
   * por status pendente; se já estava paga, não há UPDATE e devolvemos o estado
   * atual — não um erro.
   */
  r.post('/v1/payables/:id/pagar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}).optional(),
      response: {
        200: Quitacao.extend({ payableId: z.string().uuid() }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
        409: z.object({ erro: z.literal('lancamento_cancelado') }),
      },
    },
  }, rota('finance.write', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows: atual } = await tx.query<{ status: string; paid_at: Date | null }>(
      `SELECT status::text, paid_at FROM fin.entry
        WHERE id = $1 AND kind = 'despesa' AND clinic_id = $2`,
      [p.id, ctx.actor.clinicId]);

    const e = atual[0];
    if (e === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });
    if (e.status === 'cancelado' || e.status === 'estornado') {
      return reply.code(409).send({ erro: 'lancamento_cancelado' as const });
    }
    if (e.status === 'pago' && e.paid_at !== null) {
      return { payableId: p.id, status: 'pago' as const, pagoEm: e.paid_at.toISOString() };
    }

    const { rows } = await tx.query<{ paid_at: Date }>(
      `UPDATE fin.entry
          SET status = 'pago', paid_at = clock_timestamp()
        WHERE id = $1 AND kind = 'despesa' AND status = 'pendente'
        RETURNING paid_at`,
      [p.id]);

    const linha = rows[0];
    if (linha === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });
    return { payableId: p.id, status: 'pago' as const, pagoEm: linha.paid_at.toISOString() };
  }));

  /** Quitar recebimento. Mesmo desenho, mesma idempotência. */
  r.post('/v1/payments/:id/confirmar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}).optional(),
      response: {
        200: Quitacao.extend({ entryId: z.string().uuid() }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
        409: z.object({ erro: z.literal('lancamento_cancelado') }),
      },
    },
  }, rota('finance.write', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows: atual } = await tx.query<{ status: string; paid_at: Date | null }>(
      `SELECT status::text, paid_at FROM fin.entry
        WHERE id = $1 AND kind = 'receita' AND clinic_id = $2`,
      [p.id, ctx.actor.clinicId]);

    const e = atual[0];
    if (e === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });
    if (e.status === 'cancelado' || e.status === 'estornado') {
      return reply.code(409).send({ erro: 'lancamento_cancelado' as const });
    }
    if (e.status === 'pago' && e.paid_at !== null) {
      return { entryId: p.id, status: 'pago' as const, pagoEm: e.paid_at.toISOString() };
    }

    const { rows } = await tx.query<{ paid_at: Date }>(
      `UPDATE fin.entry
          SET status = 'pago', paid_at = clock_timestamp()
        WHERE id = $1 AND kind = 'receita' AND status = 'pendente'
        RETURNING paid_at`,
      [p.id]);

    const linha = rows[0];
    if (linha === undefined) return reply.code(404).send({ erro: 'nao_encontrado' as const });
    return { entryId: p.id, status: 'pago' as const, pagoEm: linha.paid_at.toISOString() };
  }));

  /**
   * Quebra-vidro: acesso de emergência ao prontuário.
   *
   * A rota é fina de propósito — quem valida é `clin.break_glass`, no banco:
   * exige profissional de saúde (não basta o papel na sessão), justificativa de
   * ao menos 20 caracteres e prazo entre 1 e 72 horas. Repetir essas regras aqui
   * criaria duas fontes de verdade, e a que vale é a do banco, porque é a que
   * grava a concessão e emite o evento de auditoria na mesma transação.
   */
  r.post('/v1/pacientes/:id/quebra-vidro', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        justificativa: z.string().min(1).max(1000),
        horas: z.coerce.number().int().min(1).max(72).optional(),
      }),
      response: {
        201: z.object({
          grantId: z.string().uuid(),
          expiraEmHoras: z.number().int(),
        }),
        422: z.object({ erro: z.string(), mensagem: z.string() }),
      },
    },
  }, rota('record.break_glass', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { justificativa: string; horas?: number };
    const horas = b.horas ?? 4;

    try {
      const { rows } = await tx.query<{ grant_id: string }>(
        `SELECT clin.break_glass($1, $2, $3) AS grant_id`,
        [p.id, b.justificativa, horas]);
      void reply.code(201);
      return { grantId: rows[0]!.grant_id, expiraEmHoras: horas };
    } catch (e) {
      // 22023 e 42501 são as recusas DELIBERADAS da função (justificativa curta,
      // prazo fora da faixa, quem pede não é profissional). Traduzir para 422
      // com a mensagem do banco preserva a explicação que ela escreveu.
      const code = (e as { code?: string }).code;
      if (code === '22023' || code === '42501') {
        return reply.code(422).send({
          erro: 'quebra_vidro_recusada',
          mensagem: (e as Error).message,
        });
      }
      throw e;
    }
  }));
}
