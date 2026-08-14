import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';
import { providers } from '../providers';

export async function teleconsultaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/teleconsultas', {
    schema: {
      body: z.object({ appointmentId: z.string().uuid() }),
      response: {
        201: z.object({
          id: z.string().uuid(),
          roomId: z.string(),
          roomUrl: z.string(),
        }),
        404: z.object({ erro: z.literal('agendamento_nao_encontrado') }),
        409: z.object({ erro: z.literal('teleconsulta_ja_existe') }),
      },
    },
  }, rota('teleconsult.write', async (tx, ctx, req, reply) => {
    const { appointmentId } = req.body as { appointmentId: string };

    const { rows: appts } = await tx.query<{ id: string; patient_name: string }>(
      `SELECT a.id,
              COALESCE(p.nome, 'Paciente') AS patient_name
         FROM clin.appointment a
         LEFT JOIN clin.patient p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
        WHERE a.id = $1`,
      [appointmentId],
    );
    if (!appts[0]) {
      return reply.code(404).send({ erro: 'agendamento_nao_encontrado' as const });
    }

    const { rows: existing } = await tx.query<{ id: string }>(
      `SELECT id FROM clin.teleconsulta WHERE appointment_id = $1`,
      [appointmentId],
    );
    if (existing[0]) {
      return reply.code(409).send({ erro: 'teleconsulta_ja_existe' as const });
    }

    const { rows: profRows } = await tx.query<{ full_name: string }>(
      `SELECT u.full_name
         FROM id."user" u
        WHERE u.id = $1`,
      [ctx.actor.userId],
    );
    const profName = profRows[0]?.full_name ?? 'Profissional';

    const teleconsult = providers().teleconsult;
    const result = await teleconsult.createRoom(
      {
        tenantId: ctx.actor.tenantId,
        actorUserId: ctx.actor.userId,
        requestId: uuidv7(),
        idempotencyKey: `teleconsulta-${appointmentId}`,
        deadlineMs: 10_000,
      },
      {
        appointmentId,
        professionalName: profName,
        patientName: appts[0].patient_name,
      },
    );

    if (!result.ok) {
      throw new Error(`teleconsult provider error: ${result.error.detail}`);
    }

    const id = uuidv7();
    await tx.query(
      `INSERT INTO clin.teleconsulta
         (id, tenant_id, clinic_id, appointment_id, provider, room_id, room_url)
       VALUES ($1, app.require_tenant_id(), $2, $3, 'jitsi', $4, $5)`,
      [id, ctx.actor.clinicId, appointmentId, result.value.roomId, result.value.roomUrl],
    );

    await tx.query(
      `SELECT audit.log('teleconsulta', 'clin', 'teleconsulta', $1, 'criada',
                         jsonb_build_object('room_id', $2::text, 'room_provider', 'jitsi'::text), $3)`,
      [id, result.value.roomId, ctx.actor.clinicId],
    );

    void reply.code(201);
    return { id, roomId: result.value.roomId, roomUrl: result.value.roomUrl };
  }));

  r.get('/v1/teleconsultas/:appointmentId', {
    schema: {
      params: z.object({ appointmentId: z.string().uuid() }),
      response: {
        200: z.object({
          id: z.string().uuid(),
          roomId: z.string(),
          roomUrl: z.string(),
          provider: z.string(),
          startedAt: z.string().nullable(),
          endedAt: z.string().nullable(),
        }),
        404: z.object({ erro: z.literal('teleconsulta_nao_encontrada') }),
      },
    },
  }, rota('teleconsult.read', async (tx, _ctx, req, reply) => {
    const { appointmentId } = req.params as { appointmentId: string };

    const { rows } = await tx.query<{
      id: string; room_id: string; room_url: string; provider: string;
      started_at: Date | null; ended_at: Date | null;
    }>(
      `SELECT id, room_id, room_url, provider, started_at, ended_at
         FROM clin.teleconsulta
        WHERE appointment_id = $1`,
      [appointmentId],
    );
    if (!rows[0]) {
      return reply.code(404).send({ erro: 'teleconsulta_nao_encontrada' as const });
    }

    return {
      id: rows[0].id,
      roomId: rows[0].room_id,
      roomUrl: rows[0].room_url,
      provider: rows[0].provider,
      startedAt: rows[0].started_at?.toISOString() ?? null,
      endedAt: rows[0].ended_at?.toISOString() ?? null,
    };
  }));

  r.put('/v1/teleconsultas/:id/encerrar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('teleconsulta_nao_encontrada') }),
        422: z.object({ erro: z.literal('teleconsulta_ja_encerrada') }),
      },
    },
  }, rota('teleconsult.write', async (tx, ctx, req, reply) => {
    const { id } = req.params as { id: string };

    const { rows } = await tx.query<{ id: string; ended_at: Date | null }>(
      `SELECT id, ended_at FROM clin.teleconsulta WHERE id = $1`,
      [id],
    );
    if (!rows[0]) {
      return reply.code(404).send({ erro: 'teleconsulta_nao_encontrada' as const });
    }
    if (rows[0].ended_at !== null) {
      return reply.code(422).send({ erro: 'teleconsulta_ja_encerrada' as const });
    }

    await tx.query(
      `UPDATE clin.teleconsulta SET ended_at = clock_timestamp() WHERE id = $1`,
      [id],
    );

    await tx.query(
      `SELECT audit.log('teleconsulta', 'clin', 'teleconsulta', $1, 'encerrada',
                         jsonb_build_object('room_id', ''::text, 'room_provider', 'jitsi'::text), $2)`,
      [id, ctx.actor.clinicId],
    );

    return { ok: true as const };
  }));
}
