import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const MetricKey = z.enum([
  'atendimentos', 'faltas', 'absenteismo', 'regulacao_aberta',
  'regulacao_urgente', 'cidadaos_ativos',
]);

export async function desempenhoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/desempenho/indicadores', {
    schema: {
      querystring: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      response: { 200: z.object({
        mes: z.string(),
        metrics: z.array(z.object({
          key: MetricKey,
          label: z.string(),
          value: z.number(),
          unit: z.enum(['numero', 'percentual']),
          previous: z.number().nullable(),
        })),
        freshness: z.object({ source: z.literal('live'), refreshedAt: z.string() }),
      }) },
    },
  }, rota('report.variation.read', async (tx, ctx, req) => {
    const q = req.query as { mes?: string };
    const mes = q.mes ?? new Date().toISOString().slice(0, 7);
    const data = `${mes}-01`;

    const { rows } = await tx.query<{
      atendimentos_atual: string; atendimentos_anterior: string;
      faltas_atual: string; faltas_anterior: string;
      agenda_atual: string; agenda_anterior: string;
      regulacao_aberta: string; regulacao_urgente: string; cidadaos_ativos: string;
    }>(
      `WITH janela AS (
         SELECT $2::date AS ini_atual,
                ($2::date + interval '1 month')::date AS fim_atual,
                ($2::date - interval '1 month')::date AS ini_anterior
       ), ag AS (
         SELECT
           count(*) FILTER (WHERE a.appointment_date >= j.ini_atual AND a.appointment_date < j.fim_atual AND a.status='atendido') AS atendimentos_atual,
           count(*) FILTER (WHERE a.appointment_date >= j.ini_anterior AND a.appointment_date < j.ini_atual AND a.status='atendido') AS atendimentos_anterior,
           count(*) FILTER (WHERE a.appointment_date >= j.ini_atual AND a.appointment_date < j.fim_atual AND a.status='faltou') AS faltas_atual,
           count(*) FILTER (WHERE a.appointment_date >= j.ini_anterior AND a.appointment_date < j.ini_atual AND a.status='faltou') AS faltas_anterior,
           count(*) FILTER (WHERE a.appointment_date >= j.ini_atual AND a.appointment_date < j.fim_atual AND a.status <> 'cancelado') AS agenda_atual,
           count(*) FILTER (WHERE a.appointment_date >= j.ini_anterior AND a.appointment_date < j.ini_atual AND a.status <> 'cancelado') AS agenda_anterior
         FROM sched.appointment a CROSS JOIN janela j WHERE a.clinic_id=$1
       ), rg AS (
         SELECT count(*) FILTER (WHERE status IN ('solicitado','em_regulacao')) AS regulacao_aberta,
                count(*) FILTER (WHERE status IN ('solicitado','em_regulacao') AND prioridade='urgente') AS regulacao_urgente
           FROM app.referral
       ), cid AS (
         SELECT count(*) AS cidadaos_ativos FROM clin.patient
          WHERE inactivated_at IS NULL AND deceased_at IS NULL AND merged_into_id IS NULL
       )
       SELECT ag.*, rg.*, cid.* FROM ag, rg, cid`,
      [ctx.actor.clinicId, data]);

    const x = rows[0];
    const n = (v: string | undefined) => Number(v ?? 0);
    const agendaAtual = n(x?.agenda_atual), agendaAnterior = n(x?.agenda_anterior);
    const faltasAtual = n(x?.faltas_atual), faltasAnterior = n(x?.faltas_anterior);
    const absAtual = agendaAtual === 0 ? 0 : Math.round((faltasAtual / agendaAtual) * 1000) / 10;
    const absAnterior = agendaAnterior === 0 ? 0 : Math.round((faltasAnterior / agendaAnterior) * 1000) / 10;

    return {
      mes,
      metrics: [
        { key: 'atendimentos' as const, label: 'Atendimentos realizados', value: n(x?.atendimentos_atual), unit: 'numero' as const, previous: n(x?.atendimentos_anterior) },
        { key: 'faltas' as const, label: 'Faltas', value: faltasAtual, unit: 'numero' as const, previous: faltasAnterior },
        { key: 'absenteismo' as const, label: 'Taxa de absenteísmo', value: absAtual, unit: 'percentual' as const, previous: absAnterior },
        { key: 'regulacao_aberta' as const, label: 'Na fila de regulação', value: n(x?.regulacao_aberta), unit: 'numero' as const, previous: null },
        { key: 'regulacao_urgente' as const, label: 'Encaminhamentos urgentes', value: n(x?.regulacao_urgente), unit: 'numero' as const, previous: null },
        { key: 'cidadaos_ativos' as const, label: 'Cidadãos ativos', value: n(x?.cidadaos_ativos), unit: 'numero' as const, previous: null },
      ],
      freshness: { source: 'live' as const, refreshedAt: new Date().toISOString() },
    };
  }));
}
