import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * O NPS da clinica.
 *
 * `msg.nps_response` recebia resposta desde a Fase 2 e ninguem conseguia ler: a
 * automacao pos-consulta perguntava, o paciente respondia, e o dado ficava.
 *
 * O indice segue a definicao padrao — %promotores menos %detratores, com os
 * neutros contando so no denominador. Nao e media de nota: media esconde
 * polarizacao, e a clinica que tem metade dos pacientes encantados e metade
 * irritada precisa saber disso, nao ver "nota 7".
 */
export async function npsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/nps', {
    schema: {
      querystring: z.object({
        dias: z.coerce.number().int().min(7).max(730).optional(),
      }),
      response: {
        200: z.object({
          nps: z.number().int(),
          respostas: z.number().int(),
          promotores: z.number().int(),
          neutros: z.number().int(),
          detratores: z.number().int(),
          comentarios: z.array(z.object({
            score: z.number().int(),
            comentario: z.string(),
            em: z.string(),
          })),
        }),
      },
    },
    // Sob `report.read`: NPS e indicador de gestao. A recepcao, que e quem mais
    // aparece nos comentarios ruins, nao precisa — e nao deveria — ler a
    // avaliacao individual do proprio atendimento.
  }, rota('report.read', async (tx, _ctx, req) => {
    const q = req.query as { dias?: number };
    const dias = q.dias ?? 90;

    const { rows } = await tx.query<{
      respostas: string; promotores: string; neutros: string; detratores: string;
    }>(
      `SELECT count(*)::text AS respostas,
              count(*) FILTER (WHERE score >= 9)::text AS promotores,
              count(*) FILTER (WHERE score BETWEEN 7 AND 8)::text AS neutros,
              count(*) FILTER (WHERE score <= 6)::text AS detratores
         FROM msg.nps_response
        WHERE received_at >= clock_timestamp() - make_interval(days => $1::int)`,
      [dias]);

    const t = rows[0];
    const respostas = Number(t?.respostas ?? 0);
    const promotores = Number(t?.promotores ?? 0);
    const detratores = Number(t?.detratores ?? 0);

    // Sem resposta nenhuma o NPS e zero POR AUSENCIA, e nao por empate. Quem le
    // precisa olhar `respostas` junto — por isso ele vai na mesma carga.
    const nps = respostas === 0
      ? 0
      : Math.round(((promotores - detratores) / respostas) * 100);

    const { rows: coment } = await tx.query<{
      score: number; comment: string; em: string;
    }>(
      `SELECT score, comment,
              to_char(received_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS em
         FROM msg.nps_response
        WHERE received_at >= clock_timestamp() - make_interval(days => $1::int)
          AND btrim(coalesce(comment, '')) <> ''
        ORDER BY received_at DESC
        LIMIT 50`,
      [dias]);

    return {
      nps,
      respostas,
      promotores,
      neutros: Number(t?.neutros ?? 0),
      detratores,
      // O comentario e o que diz O QUE consertar. A nota sozinha so avisa que
      // ha algo errado.
      comentarios: coment.map((c) => ({
        score: c.score, comentario: c.comment, em: c.em,
      })),
    };
  }));
}
