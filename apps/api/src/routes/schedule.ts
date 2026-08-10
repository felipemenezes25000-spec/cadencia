import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createAppointment, moveAppointment, setStatus, checkIn,
  dayCounters, dayQueue, needsYou,
} from '@cadencia/scheduling';
import { rota } from '../guard';

const STATUS = z.enum(['agendado', 'confirmado', 'aguardando', 'atendendo',
                       'atendido', 'faltou', 'cancelado']);

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/agenda/agendamentos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        roomId: z.string().uuid().optional(),
        operadoraNome: z.string().optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime().optional(),
        encaixe: z.boolean().optional(),
        teleconsulta: z.boolean().optional(),
        observacao: z.string().optional(),
      }),
      response: {
        201: z.object({
          appointmentId: z.string().uuid(), startsAt: z.string(), endsAt: z.string(),
          appointmentDate: z.string(), avisos: z.array(z.literal('horario_bloqueado')).readonly(),
        }),
      },
    },
  }, rota('appointment.write', async (tx, ctx, req, reply) => {
    const b = req.body as Parameters<typeof createAppointment>[1];
    const resultado = await createAppointment(tx, { ...b, clinicId: ctx.actor.clinicId });
    if (!resultado.ok) {
      if (resultado.error.kind === 'horario_ocupado') {
        erroDominio('horario_ocupado', 409, { encaixePossivel: true });
      }
      erroDominio(resultado.error.kind, 422);
    }
    void reply.code(201);
    return resultado.value;
  }));

  r.patch('/v1/agenda/agendamentos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        startsAt: z.string().datetime(),
        professionalId: z.string().uuid().optional(),
        roomId: z.string().uuid().nullable().optional(),
      }),
      response: {
        200: z.object({ appointmentId: z.string(), startsAt: z.string(),
                        endsAt: z.string(), appointmentDate: z.string() }),
      },
    },
  }, rota('appointment.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { startsAt: string; professionalId?: string; roomId?: string | null };
    const resultado = await moveAppointment(tx, { appointmentId: p.id, ...b });
    if (!resultado.ok) {
      if (resultado.error.kind === 'horario_ocupado') {
        erroDominio('horario_ocupado', 409, { encaixePossivel: true });
      }
      erroDominio(resultado.error.kind, 422);
    }
    return resultado.value;
  }));

  r.post('/v1/agenda/agendamentos/:id/status', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ status: STATUS, cancelReason: z.string().optional() }),
      response: { 200: z.object({ appointmentId: z.string(), status: STATUS }) },
    },
  }, rota('appointment.write', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { status: z.infer<typeof STATUS>; cancelReason?: string };
    const resultado = await setStatus(tx, { appointmentId: p.id, ...b });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    return resultado.value;
  }));

  r.post('/v1/agenda/agendamentos/:id/checkin', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ appointmentId: z.string(), status: z.literal('aguardando'),
                        pendentes: z.array(z.string()).readonly() }),
      },
    },
  }, rota('appointment.checkin', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const resultado = await checkIn(tx, { appointmentId: p.id });
    if (!resultado.ok) erroDominio(resultado.error.kind, 404);
    return resultado.value;
  }));

  r.get('/v1/agenda/dia', {
    schema: {
      querystring: z.object({
        dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        professionalId: z.string().uuid().optional(),
        status: STATUS.optional(),
      }),
      response: {
        200: z.object({
          contadores: z.object({ agendados: z.number(), confirmados: z.number(),
            aguardando: z.number(), atendidos: z.number(), faltas: z.number() }),
          fila: z.array(z.object({
            appointmentId: z.string(), startsAt: z.string(), endsAt: z.string(),
            patientId: z.string(), displayName: z.string(),
            professionalId: z.string(), professionalNome: z.string(),
            procedureNome: z.string().nullable(), procedureCor: z.string().nullable(),
            operadoraNome: z.string().nullable(), status: STATUS,
            encaixe: z.boolean(), teleconsulta: z.boolean(), primeiraVez: z.boolean(),
            cadastroPreliminar: z.boolean(), encounterId: z.string().nullable(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { dia: string; professionalId?: string; status?: never };
    const base = { clinicId: ctx.actor.clinicId, dia: q.dia,
                   ...(q.professionalId === undefined ? {} : { professionalId: q.professionalId }) };
    const [contadores, fila] = await Promise.all([
      dayCounters(tx, base),
      dayQueue(tx, { ...base, ...(q.status === undefined ? {} : { status: q.status }) }),
    ]);
    return { contadores, fila };
  }));

  r.get('/v1/agenda/precisa-de-voce', {
    schema: {
      querystring: z.object({ professionalId: z.string().uuid().optional() }),
      response: {
        200: z.object({
          confirmacoesSemResposta: z.number(), prescricoesNaoAssinadas: z.number(),
          resultadosChegados: z.number(), rascunhosDeOntem: z.number(),
          guiasAFaturar: z.number(),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { professionalId?: string };
    return needsYou(tx, { clinicId: ctx.actor.clinicId,
      ...(q.professionalId === undefined ? {} : { professionalId: q.professionalId }) });
  }));
}
