import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * Os três indicadores do topo da tela de Desempenho.
 *
 * Cada um compara um MÊS com o mês anterior — e a tela mostra "Agosto vs Julho".
 * Mês de calendário é o que a gestora fecha com o contador, e é nesse recorte
 * que ela já pensa; janela móvel daria um número mais estável e sem interlocutor.
 *
 * O corte usa app.local_date com o fuso da CLÍNICA (§10 item 10): um pagamento
 * das 22h do dia 31 em Manaus pertence a agosto, não a setembro.
 */

/**
 * Variação percentual que nunca devolve Infinity nem NaN.
 *
 * Dividir por zero produz Infinity, que o JSON serializa como `null` e a tela
 * renderiza como buraco. Zero contra zero é variação ZERO; algo contra zero é
 * 100% de crescimento — não infinito.
 */
function variacao(atual: number, anterior: number): number {
  if (anterior === 0) return atual === 0 ? 0 : 100;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

export async function desempenhoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/desempenho/indicadores', {
    schema: {
      querystring: z.object({
        // AAAA-MM. Ausente = mês corrente.
        mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }),
      response: {
        200: z.object({
          indicators: z.array(z.object({
            metric: z.enum(['receita', 'ticket_medio', 'ocupacao']),
            deltaAbsolute: z.number().int(),
            deltaPercent: z.number(),
          })),
          freshness: z.object({
            source: z.enum(['live', 'matview']),
            refreshedAt: z.string().nullable(),
          }),
        }),
      },
    },
  }, rota('report.variation.read', async (tx, ctx, req) => {
    const q = req.query as { mes?: string };

    const { rows } = await tx.query<{
      receita_atual: string; receita_anterior: string;
      atendimentos_atual: string; atendimentos_anterior: string;
      agendados_atual: string; comparecidos_atual: string;
      agendados_anterior: string; comparecidos_anterior: string;
    }>(
      // Uma consulta só, com FILTER por janela: duas consultas separadas leriam
      // a tabela duas vezes e poderiam cair em lados diferentes de um commit.
      `WITH cl AS (
         SELECT timezone FROM app.clinic WHERE id = $1
       ), janela AS (
         SELECT
           date_trunc('month',
             coalesce($2::date,
                      app.local_date(clock_timestamp(), (SELECT timezone FROM cl))))::date
             AS ini_atual,
           (date_trunc('month',
             coalesce($2::date,
                      app.local_date(clock_timestamp(), (SELECT timezone FROM cl))))
            + interval '1 month')::date AS fim_atual,
           (date_trunc('month',
             coalesce($2::date,
                      app.local_date(clock_timestamp(), (SELECT timezone FROM cl))))
            - interval '1 month')::date AS ini_anterior
       ), fin AS (
         SELECT
           coalesce(sum(e.amount_cents) FILTER (
             WHERE app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   >= (SELECT ini_atual FROM janela)), 0) AS receita_atual,
           coalesce(sum(e.amount_cents) FILTER (
             WHERE app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   <  (SELECT ini_atual FROM janela)
               AND app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   >= (SELECT ini_anterior FROM janela)), 0) AS receita_anterior,
           count(*) FILTER (
             WHERE app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   >= (SELECT ini_atual FROM janela)) AS atendimentos_atual,
           count(*) FILTER (
             WHERE app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   <  (SELECT ini_atual FROM janela)
               AND app.local_date(e.paid_at, (SELECT timezone FROM cl))
                   >= (SELECT ini_anterior FROM janela)) AS atendimentos_anterior
           FROM fin.entry e
          WHERE e.clinic_id = $1 AND e.kind = 'receita'
            AND e.status = 'pago' AND e.paid_at IS NOT NULL
            AND app.local_date(e.paid_at, (SELECT timezone FROM cl))
                < (SELECT fim_atual FROM janela)
       ), ag AS (
         SELECT
           count(*) FILTER (WHERE a.appointment_date >= (SELECT ini_atual FROM janela))
             AS agendados_atual,
           count(*) FILTER (WHERE a.appointment_date >= (SELECT ini_atual FROM janela)
                              AND a.status = 'atendido') AS comparecidos_atual,
           count(*) FILTER (WHERE a.appointment_date <  (SELECT ini_atual FROM janela)
                              AND a.appointment_date >= (SELECT ini_anterior FROM janela))
             AS agendados_anterior,
           count(*) FILTER (WHERE a.appointment_date <  (SELECT ini_atual FROM janela)
                              AND a.appointment_date >= (SELECT ini_anterior FROM janela)
                              AND a.status = 'atendido') AS comparecidos_anterior
           FROM sched.appointment a
          WHERE a.clinic_id = $1 AND a.status <> 'cancelado'
            AND a.appointment_date < (SELECT fim_atual FROM janela)
       )
       SELECT fin.*, ag.* FROM fin, ag`,
      [ctx.actor.clinicId, q.mes === undefined ? null : `${q.mes}-01`]);

    const l = rows[0];
    const receitaAtual = Number(l?.receita_atual ?? 0);
    const receitaAnterior = Number(l?.receita_anterior ?? 0);
    const nAtual = Number(l?.atendimentos_atual ?? 0);
    const nAnterior = Number(l?.atendimentos_anterior ?? 0);

    const ticketAtual = nAtual === 0 ? 0 : Math.round(receitaAtual / nAtual);
    const ticketAnterior = nAnterior === 0 ? 0 : Math.round(receitaAnterior / nAnterior);

    const agAtual = Number(l?.agendados_atual ?? 0);
    const compAtual = Number(l?.comparecidos_atual ?? 0);
    const agAnterior = Number(l?.agendados_anterior ?? 0);
    const compAnterior = Number(l?.comparecidos_anterior ?? 0);

    // Ocupação é PONTO PERCENTUAL, não centavo: 62% contra 55% é +7 pontos.
    // Chamar isso de "+12,7%" seria tecnicamente verdadeiro e praticamente
    // enganoso — ninguém gerencia agenda em variação relativa de taxa.
    const ocupAtual = agAtual === 0 ? 0 : Math.round((compAtual / agAtual) * 100);
    const ocupAnterior = agAnterior === 0 ? 0 : Math.round((compAnterior / agAnterior) * 100);

    return {
      indicators: [
        {
          metric: 'receita' as const,
          deltaAbsolute: receitaAtual - receitaAnterior,
          deltaPercent: variacao(receitaAtual, receitaAnterior),
        },
        {
          metric: 'ticket_medio' as const,
          deltaAbsolute: ticketAtual - ticketAnterior,
          deltaPercent: variacao(ticketAtual, ticketAnterior),
        },
        {
          metric: 'ocupacao' as const,
          deltaAbsolute: ocupAtual - ocupAnterior,
          deltaPercent: variacao(ocupAtual, ocupAnterior),
        },
      ],
      // 'live' porque a conta acabou de ser feita na transação da requisição.
      // Quando a matview de relatório servir esta tela, o carimbo passa a ser o
      // do último refresh — e a tela já publica isso para quem lê o número.
      freshness: { source: 'live' as const, refreshedAt: null },
    };
  }));
}
