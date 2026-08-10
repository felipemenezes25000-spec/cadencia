import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

const TIPOS = ['almoco', 'ausencia', 'feriado', 'bloqueio', 'manutencao'] as const;

/**
 * Bloqueios da agenda: almoco, ausencia, feriado, manutencao de sala.
 *
 * `sched.block` existia no banco desde a Fase 1, com constraint de sobreposicao
 * e tudo, e nao tinha rota nenhuma — a agenda so sabia agendar. Na pratica a
 * recepcao marcava consulta em cima do almoco do medico e descobria no dia.
 *
 * O motivo e obrigatorio porque bloqueio sem motivo vira buraco que ninguem
 * sabe explicar, e a recepcao acaba desbloqueando por engano.
 */
export async function bloqueioRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/agenda/bloqueios', {
    schema: {
      body: z.object({
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        kind: z.enum(TIPOS),
        motivo: z.string().trim().min(1).max(200),
        /** Ausente = bloqueia a unidade inteira (feriado, manutencao). */
        professionalId: z.string().uuid().optional(),
        roomId: z.string().uuid().optional(),
      }),
      response: { 201: z.object({ blockId: z.string().uuid() }) },
    },
  }, rota('appointment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      startsAt: string; endsAt: string; kind: typeof TIPOS[number];
      motivo: string; professionalId?: string; roomId?: string };

    // CHECK (ends_at > starts_at) no banco. Recusar aqui devolve validacao em
    // vez de 500 vindo do Postgres, que o usuario leria como falha do sistema.
    if (new Date(b.endsAt) <= new Date(b.startsAt)) {
      erroDominio('intervalo_invalido', 400);
    }

    const blockId = uuidv7();
    try {
      await tx.query(
        `INSERT INTO sched.block
           (id, professional_id, clinic_id, room_id, starts_at, ends_at,
            kind, motivo, created_by)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
                 $7::sched.block_kind, $8, app.current_user_id())`,
        [blockId, b.professionalId ?? null, ctx.actor.clinicId, b.roomId ?? null,
         b.startsAt, b.endsAt, b.kind, b.motivo.trim()]);
    } catch (e) {
      // 23P01 = exclusion_violation, de `ex_block_sem_sobreposicao`. Traduzir
      // para 409 diz a recepcao o que aconteceu: ja existe bloqueio naquele
      // horario. Deixar subir como 500 diria "o sistema quebrou".
      if ((e as { code?: string }).code === '23P01') {
        erroDominio('bloqueio_sobreposto', 409);
      }
      throw e;
    }

    void reply.code(201);
    return { blockId };
  }));

  r.get('/v1/agenda/bloqueios', {
    schema: {
      querystring: z.object({
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            blockId: z.string().uuid(),
            kind: z.string(),
            motivo: z.string(),
            startsAt: z.string(),
            endsAt: z.string(),
            professionalId: z.string().uuid().nullable(),
            professionalNome: z.string().nullable(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { de: string; ate: string };
    const { rows } = await tx.query<{
      id: string; kind: string; motivo: string; starts_at: string;
      ends_at: string; professional_id: string | null; nome: string | null;
    }>(
      // O intervalo e comparado no FUSO DA UNIDADE: "os bloqueios de 10 a 14 de
      // junho" e a semana da clinica, nao a janela UTC equivalente. Sem isso, o
      // almoco das 12h de uma clinica no Acre cai fora do filtro do proprio dia.
      `SELECT b.id, b.kind::text AS kind, b.motivo,
              to_char(b.starts_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS starts_at,
              to_char(b.ends_at,   'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS ends_at,
              b.professional_id, u.full_name AS nome
         FROM sched.block b
         JOIN app.clinic c ON (c.tenant_id, c.id) = (b.tenant_id, b.clinic_id)
         LEFT JOIN app.professional p
                ON (p.tenant_id, p.id) = (b.tenant_id, b.professional_id)
         LEFT JOIN id."user" u ON u.id = p.user_id
        WHERE b.clinic_id = $1
          AND app.local_date(b.starts_at, c.timezone) BETWEEN $2::date AND $3::date
        ORDER BY b.starts_at`,
      [ctx.actor.clinicId, q.de, q.ate]);

    return {
      itens: rows.map((x) => ({
        blockId: x.id,
        kind: x.kind,
        motivo: x.motivo,
        startsAt: x.starts_at,
        endsAt: x.ends_at,
        professionalId: x.professional_id,
        professionalNome: x.nome,
      })),
    };
  }));

  r.delete('/v1/agenda/bloqueios/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 204: z.null() },
    },
  }, rota('appointment.write', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    // DELETE de verdade: bloqueio nao e registro clinico nem financeiro, e um
    // almoco cancelado nao precisa sobreviver para auditoria. A trilha ja
    // registra a operacao.
    const { rowCount } = await tx.query(
      `DELETE FROM sched.block WHERE id = $1`, [p.id]);
    if (rowCount === 0) erroDominio('bloqueio_nao_encontrado', 404);
    void reply.code(204);
    return null;
  }));
}
