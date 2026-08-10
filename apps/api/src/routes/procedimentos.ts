import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * Os procedimentos que o compositor da agenda oferece.
 *
 * `maisFrequente` sai do USO recente, nao de uma flag configurada nem da ordem
 * alfabetica. A recepcao agenda o mesmo punhado de procedimentos o dia inteiro;
 * o atalho so e atalho se refletir o que ela de fato faz. Uma flag manual
 * envelhece na primeira mudanca de rotina da clinica e ninguem lembra de mexer.
 */
export async function procedimentoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/procedimentos', {
    schema: {
      querystring: z.object({
        dias: z.coerce.number().int().min(7).max(365).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            procedureId: z.string().uuid(),
            code: z.string(),
            nome: z.string(),
            cor: z.string(),
            duracaoMin: z.number().int(),
            usosRecentes: z.number().int(),
            maisFrequente: z.boolean(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { dias?: number };

    const { rows } = await tx.query<{
      id: string; code: string; nome: string; cor: string;
      duracao_min: number; usos: string;
    }>(
      `SELECT p.id, p.code, p.nome, p.cor, p.duracao_min,
              count(a.id) AS usos
         FROM sched.procedure p
         LEFT JOIN sched.appointment a
                ON (a.tenant_id, a.procedure_id) = (p.tenant_id, p.id)
               AND a.clinic_id = $1
               AND a.status <> 'cancelado'
               AND a.appointment_date >= (current_date - make_interval(days => $2::int))
        GROUP BY p.id, p.code, p.nome, p.cor, p.duracao_min
        ORDER BY count(a.id) DESC, p.nome COLLATE "pt-BR-x-icu"`,
      [ctx.actor.clinicId, q.dias ?? 90]);

    // O corte do "mais frequente" e o terco superior por uso, com no minimo um
    // uso. Marcar todos, ou marcar por posicao fixa, faria a clinica nova (sem
    // historico) exibir destaque arbitrario no primeiro dia.
    const maiorUso = Math.max(0, ...rows.map((x) => Number(x.usos)));
    const corte = Math.max(1, Math.ceil(maiorUso / 3));

    return {
      itens: rows.map((x) => ({
        procedureId: x.id,
        code: x.code,
        nome: x.nome,
        cor: x.cor,
        duracaoMin: x.duracao_min,
        usosRecentes: Number(x.usos),
        maisFrequente: Number(x.usos) >= corte && maiorUso > 0,
      })),
    };
  }));

  /**
   * Quem atende nesta unidade.
   *
   * Sob `appointment.read`, e nao sob `membership.read`: a recepcao precisa da
   * lista para agendar e nao tem — nem deveria ter — permissao de ler vinculos.
   * O que sai daqui e o minimo para escolher com quem marcar: nome e registro.
   * Nao sai e-mail, CPF nem papel.
   */
  r.get('/v1/profissionais', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            professionalId: z.string().uuid(),
            nome: z.string(),
            conselho: z.string(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; nome: string | null; conselho: string;
    }>(
      `SELECT pr.id,
              u.full_name AS nome,
              pr.conselho_profissional || ' ' || pr.numero_conselho
                || '/' || pr.uf_conselho AS conselho
         FROM app.professional pr
         JOIN id."user" u ON u.id = pr.user_id
         JOIN app.membership m
              ON m.tenant_id = pr.tenant_id AND m.user_id = pr.user_id
             AND m.clinic_id = $1 AND m.revoked_at IS NULL
        WHERE u.disabled_at IS NULL
        ORDER BY u.full_name COLLATE "pt-BR-x-icu"`,
      [ctx.actor.clinicId]);

    return {
      itens: rows.map((x) => ({
        professionalId: x.id,
        nome: x.nome ?? '',
        conselho: x.conselho,
      })),
    };
  }));
}
