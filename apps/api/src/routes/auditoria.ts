import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * A trilha, consultável.
 *
 * É o diferencial nº 1 do produto contra o líder de mercado, cujos logs cobrem
 * apenas agendamento e financeiro — a SBIS NGS1.07 exige trilha contínua e
 * exportável do que aconteceu com o registro clínico. Ter a trilha e não poder
 * lê-la é o mesmo que não tê-la para efeito de auditoria.
 *
 * O QUE ESTA ROTA NÃO FAZ, e não por esquecimento (§10 item 8):
 *   - não devolve identificador de paciente: `entity_id` fica de fora quando a
 *     entidade é do schema clínico;
 *   - não devolve conteúdo clínico: a trilha nasce sem ele, e `meta` já é
 *     limitada por whitelist no próprio CHECK da tabela;
 *   - não permite escrita de forma nenhuma: `app_rw` só tem SELECT em
 *     audit.event, e nem o dono do schema derruba linha.
 *
 * O painel de auditoria não pode virar a superfície que ele existe para vigiar.
 */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Schemas cujo `entity_id` aponta para pessoa ou registro clínico. */
const SCHEMAS_CLINICOS = new Set(['clin', 'msg', 'tiss']);

export async function auditoriaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/auditoria', {
    schema: {
      querystring: z.object({
        tipo: z.string().max(60).optional(),
        de: Data.optional(),
        ate: Data.optional(),
        outcome: z.enum(['sucesso', 'negado', 'erro']).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            // bigint de sequência, não uuid: a trilha é append-only e a ordem
            // do contador É informação — buraco na sequência denuncia remoção.
            eventId: z.string(),
            ocorridoEm: z.string(),
            eventType: z.string(),
            entidade: z.string(),
            entityId: z.string().nullable(),
            outcome: z.string(),
            ator: z.string().nullable(),
            atorKind: z.string(),
            meta: z.record(z.string(), z.unknown()),
          })),
        }),
      },
    },
  }, rota('audit.read', async (tx, ctx, req) => {
    const q = req.query as {
      tipo?: string; de?: string; ate?: string;
      outcome?: string; limit?: number };

    const { rows } = await tx.query<{
      id: string | number; occurred_at: Date; event_type: string;
      entity_schema: string; entity_table: string; entity_id: string | null;
      outcome: string; actor_kind: string; ator: string | null;
      meta: Record<string, unknown> | null;
    }>(
      // O recorte por data usa o fuso da CLÍNICA: "o que aconteceu no dia 12"
      // é uma pergunta feita em horário local, e a resposta não pode mudar
      // conforme o fuso do servidor.
      `SELECT e.id, e.occurred_at, e.event_type,
              e.entity_schema, e.entity_table, e.entity_id,
              e.outcome, e.actor_kind, u.full_name AS ator, e.meta
         FROM audit.event e
         JOIN app.clinic cl ON cl.id = $1
         LEFT JOIN id."user" u ON u.id = e.actor_user_id
        WHERE e.tenant_id = app.current_tenant_id()
          AND ($2::text IS NULL OR e.event_type = $2::text)
          AND ($3::text IS NULL OR e.outcome = $3::text)
          AND ($4::date IS NULL
               OR app.local_date(e.occurred_at, cl.timezone) >= $4::date)
          AND ($5::date IS NULL
               OR app.local_date(e.occurred_at, cl.timezone) <= $5::date)
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT $6`,
      [ctx.actor.clinicId, q.tipo ?? null, q.outcome ?? null,
       q.de ?? null, q.ate ?? null, q.limit ?? 200]);

    return {
      itens: rows.map((x) => ({
        eventId: String(x.id),
        ocorridoEm: x.occurred_at.toISOString(),
        eventType: x.event_type,
        entidade: `${x.entity_schema}.${x.entity_table}`,
        // Id de entidade clínica não sai daqui. Quem investiga um incidente
        // pede o caso completo pelo canal próprio, com registro do acesso;
        // a listagem serve para achar O QUE aconteceu, não para navegar
        // até o prontuário de alguém.
        entityId: SCHEMAS_CLINICOS.has(x.entity_schema) ? null : x.entity_id,
        outcome: x.outcome,
        ator: x.ator,
        atorKind: x.actor_kind,
        meta: x.meta ?? {},
      })),
    };
  }));
}
