import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

const Prioridade = z.enum(['baixa', 'normal', 'alta', 'urgente']);

/** Violacao do indice unico parcial `ux_waitlist_ativa`. */
const UNIQUE_VIOLATION = '23505';

export async function listaDeEsperaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/agenda/lista-espera', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            waitlistId: z.string().uuid(),
            patientId: z.string().uuid(),
            patientNome: z.string(),
            professionalId: z.string().uuid().nullable(),
            prioridade: Prioridade,
            janelaDe: z.string().nullable(),
            janelaAte: z.string().nullable(),
            observacao: z.string().nullable(),
            chamadaEm: z.string().nullable(),
            esperandoDesde: z.string(),
          })),
        }),
      },
    },
  }, rota('appointment.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; patient_id: string; patient_nome: string;
      professional_id: string | null; prioridade: 'baixa' | 'normal' | 'alta' | 'urgente';
      janela_de: string | null; janela_ate: string | null; observacao: string | null;
      called_at: Date | null; created_at: Date;
    }>(
      // A ordem e a do indice ix_waitlist_fila: prioridade DESC, chegada.
      // Ordenar no cliente daria uma fila diferente por aba aberta.
      `SELECT w.id, w.patient_id, p.full_name AS patient_nome, w.professional_id,
              w.prioridade, w.janela_de::text, w.janela_ate::text, w.observacao,
              w.called_at, w.created_at
         FROM sched.waitlist w
         JOIN clin.patient p ON (p.tenant_id, p.id) = (w.tenant_id, w.patient_id)
        WHERE w.clinic_id = $1 AND w.closed_at IS NULL
        ORDER BY w.prioridade DESC, w.created_at`,
      [ctx.actor.clinicId]);

    return {
      itens: rows.map((x) => ({
        waitlistId: x.id,
        patientId: x.patient_id,
        patientNome: x.patient_nome,
        professionalId: x.professional_id,
        prioridade: x.prioridade,
        janelaDe: x.janela_de,
        janelaAte: x.janela_ate,
        observacao: x.observacao,
        chamadaEm: x.called_at === null ? null : x.called_at.toISOString(),
        esperandoDesde: x.created_at.toISOString(),
      })),
    };
  }));

  r.post('/v1/agenda/lista-espera', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        professionalId: z.string().uuid().optional(),
        procedureId: z.string().uuid().optional(),
        prioridade: Prioridade.optional(),
        janelaDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        janelaAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        observacao: z.string().max(500).optional(),
      }),
      response: {
        201: z.object({ waitlistId: z.string().uuid() }),
        409: z.object({ erro: z.literal('ja_na_fila') }),
      },
    },
  }, rota('appointment.write', async (tx, ctx, req, reply) => {
    const body = req.body as {
      patientId: string; professionalId?: string; procedureId?: string;
      prioridade?: z.infer<typeof Prioridade>;
      janelaDe?: string; janelaAte?: string; observacao?: string;
    };
    const id = uuidv7();

    try {
      await tx.query(
        `INSERT INTO sched.waitlist
           (id, patient_id, professional_id, clinic_id, procedure_id,
            prioridade, janela_de, janela_ate, observacao, created_by)
         VALUES ($1, $2, $3, $4, $5, coalesce($6, 'normal')::sched.waitlist_priority,
                 $7::date, $8::date, $9, $10)`,
        [id, body.patientId, body.professionalId ?? null, ctx.actor.clinicId,
         body.procedureId ?? null, body.prioridade ?? null,
         body.janelaDe ?? null, body.janelaAte ?? null,
         body.observacao ?? null, ctx.actor.userId]);
    } catch (e) {
      // `ux_waitlist_ativa` usa coalesce(professional_id, uuid-zero): "qualquer
      // profissional" e UMA entrada, nao N. Traduzir o 23505 aqui e o que faz a
      // recepcao ver "ja esta na fila" em vez de um 500 sem explicacao.
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply.code(409).send({ erro: 'ja_na_fila' as const });
      }
      throw e;
    }

    return reply.code(201).send({ waitlistId: id });
  }));

  r.delete('/v1/agenda/lista-espera/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ motivo: z.string().min(2).max(120) }),
      response: {
        200: z.object({ encerrada: z.literal(true) }),
        404: z.object({ erro: z.literal('nao_encontrado') }),
      },
    },
  }, rota('appointment.write', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { motivo: string };

    // O CHECK da tabela exige que closed_at e close_reason andem juntos: nao
    // existe entrada encerrada sem motivo registrado.
    const { rowCount } = await tx.query(
      `UPDATE sched.waitlist
          SET closed_at = clock_timestamp(), close_reason = $2
        WHERE id = $1 AND closed_at IS NULL`,
      [p.id, b.motivo]);

    if (rowCount === 0) return reply.code(404).send({ erro: 'nao_encontrado' as const });
    return reply.code(200).send({ encerrada: true as const });
  }));
}
