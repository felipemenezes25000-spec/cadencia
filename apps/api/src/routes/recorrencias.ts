// apps/api/src/routes/recorrencias.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { cancelarRecorrenciaFutura, criarRecorrencia } from '@cadencia/scheduling';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');

/**
 * Agendamento recorrente — fisioterapia toda terça, retorno mensal.
 *
 * `sched.recurrence` existia no banco desde a Fase 1, com FK vinda de
 * `sched.appointment.recurrence_id`, e nunca teve uma linha: a tabela foi criada
 * e o recurso não foi construído. Na prática a recepção marcava as doze sessões
 * uma a uma, e quando o paciente mudava de horário refazia as doze.
 *
 * A data e a hora chegam SEPARADAS e em hora de parede, não como instante:
 * "toda terça às 14h" é um compromisso com o relógio da clínica. Receber
 * timestamptz obrigaria o cliente a fazer a conversão de fuso — e o cliente é um
 * navegador que pode estar em outro estado.
 */
export async function recorrenciaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/agenda/recorrencias', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid(),
        primeiraData: DATA,
        hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora no formato HH:MM'),
        freq: z.enum(['diaria', 'semanal', 'quinzenal', 'mensal']),
        intervalo: z.number().int().min(1).max(12).default(1),
        horizonteAte: DATA,
        observacao: z.string().trim().max(500).optional(),
      }),
      response: {
        201: z.object({
          recurrenceId: z.string().uuid(),
          criadas: z.array(z.object({
            quando: z.string(), appointmentId: z.string().uuid(),
          })),
          // As recusadas voltam no MESMO 201: a serie nao e tudo-ou-nada, e
          // devolver erro esconderia as onze sessoes que entraram.
          recusadas: z.array(z.object({
            quando: z.string(),
            motivo: z.enum(['horario_ocupado', 'sala_ocupada', 'erro']),
          })),
        }),
      },
    },
  }, rota('appointment.write', async (tx, ctx, req, reply) => {
    const b = req.body as Parameters<typeof criarRecorrencia>[1] & { intervalo: number };

    if (b.horizonteAte < b.primeiraData) {
      erroDominio('horizonte_antes_do_inicio', 400);
    }

    const res = await criarRecorrencia(tx, { ...b, clinicId: ctx.actor.clinicId });
    if (!res.ok) {
      if (res.error.kind === 'serie_muito_longa') {
        erroDominio('serie_muito_longa', 422, { mensagem: res.error.mensagem });
      }
      erroDominio(res.error.kind, 422);
    }

    void reply.code(201);
    // Copia mutavel: o dominio devolve `readonly[]`, e o schema do fastify
    // infere array comum. Espalhar aqui e mais honesto que afrouxar o tipo do
    // dominio, onde a imutabilidade e o que impede a lista ser editada depois.
    return {
      recurrenceId: res.value.recurrenceId,
      criadas: [...res.value.criadas],
      recusadas: [...res.value.recusadas],
    };
  }));

  r.get('/v1/agenda/recorrencias', {
    schema: {
      querystring: z.object({ patientId: z.string().uuid().optional() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            recurrenceId: z.string().uuid(),
            pacienteNome: z.string(),
            profissionalNome: z.string(),
            procedimentoNome: z.string().nullable(),
            freq: z.string(),
            intervalo: z.number().int(),
            horizonteAte: z.string(),
            /** Só o que ainda vem: passado não se cancela nem se remarca. */
            futurasAtivas: z.number().int(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx, req) => {
    const q = req.query as { patientId?: string };
    const { rows } = await tx.query<{
      id: string; paciente: string; profissional: string | null;
      procedimento: string | null; freq: string; intervalo: number;
      horizonte: string; futuras: string;
    }>(
      `SELECT rec.id, p.full_name AS paciente, u.full_name AS profissional,
              pr.nome AS procedimento, rec.freq::text AS freq, rec.intervalo,
              rec.horizonte_ate::text AS horizonte,
              (SELECT count(*) FROM sched.appointment a
                WHERE a.recurrence_id = rec.id
                  AND a.status IN ('agendado','confirmado')
                  AND a.appointment_date >= app.local_date(clock_timestamp(), c.timezone)
              )::text AS futuras
         FROM sched.recurrence rec
         JOIN app.clinic c ON (c.tenant_id, c.id) = (rec.tenant_id, rec.clinic_id)
         JOIN clin.patient p ON (p.tenant_id, p.id) = (rec.tenant_id, rec.patient_id)
         LEFT JOIN app.professional prof
                ON (prof.tenant_id, prof.id) = (rec.tenant_id, rec.professional_id)
         LEFT JOIN id."user" u ON u.id = prof.user_id
         LEFT JOIN sched.procedure pr
                ON (pr.tenant_id, pr.id) = (rec.tenant_id, rec.procedure_id)
        WHERE rec.clinic_id = $1
          AND ($2::uuid IS NULL OR rec.patient_id = $2::uuid)
        ORDER BY rec.created_at DESC`,
      [ctx.actor.clinicId, q.patientId ?? null]);

    return {
      itens: rows.map((x) => ({
        recurrenceId: x.id,
        pacienteNome: x.paciente,
        profissionalNome: x.profissional ?? '',
        procedimentoNome: x.procedimento,
        freq: x.freq,
        intervalo: x.intervalo,
        horizonteAte: x.horizonte,
        futurasAtivas: Number(x.futuras),
      })),
    };
  }));

  r.delete('/v1/agenda/recorrencias/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ canceladas: z.number().int() }) },
    },
  }, rota('appointment.write', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const { rowCount } = await tx.query(
      `SELECT 1 FROM sched.recurrence WHERE id = $1`, [p.id]);
    if (rowCount === 0) erroDominio('recorrencia_nao_encontrada', 404);

    // A serie em si NAO e apagada: ela e o motivo de as consultas passadas
    // existirem. O que para e o que ainda vem.
    const canceladas = await cancelarRecorrenciaFutura(tx, p.id, ctx.actor.clinicId);
    return { canceladas };
  }));
}
