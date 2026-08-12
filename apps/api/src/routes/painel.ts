import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

/**
 * O painel de abertura: aniversariantes e os seis gráficos do inventário.
 *
 * Duas escolhas atravessam o arquivo:
 *
 * 1. Todo recorte de DATA usa `app.local_date` com o fuso da clínica (§10 item
 *    10). "Aniversariantes de hoje" é uma pergunta feita em horário local; se
 *    derivasse de `current_date` do servidor, a recepção em Manaus veria a
 *    lista do dia seguinte a partir das 21h.
 *
 * 2. A duração do atendimento é a REALIZADA (`started_at` -> `finished_at`), não
 *    a agendada. Quem monta a grade precisa exatamente da diferença entre as
 *    duas: se a consulta de 30 minutos leva 45, a agenda está errada e o dia
 *    atrasa cumulativamente.
 */

export async function painelRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/painel/aniversariantes', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            patientId: z.string().uuid(),
            nome: z.string(),
            idade: z.number().int(),
            telefone: z.string().nullable(),
            temAgendamentoHoje: z.boolean(),
          })),
        }),
      },
    },
  }, rota('patient.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; display_name: string; idade: string;
      phone_primary: string | null; tem_agenda: boolean;
    }>(
      // Compara MÊS e DIA, nunca a data inteira: comparar a data acharia só
      // quem nasceu hoje, e recém-nascido não faz aniversário.
      `SELECT p.id, p.display_name,
              extract(year FROM age(
                app.local_date(clock_timestamp(), c.timezone), p.birth_date))::int
                AS idade,
              p.phone_primary,
              EXISTS (
                SELECT 1 FROM sched.appointment a
                 WHERE a.tenant_id = p.tenant_id AND a.patient_id = p.id
                   AND a.appointment_date
                       = app.local_date(clock_timestamp(), c.timezone)
                   AND a.status <> 'cancelado') AS tem_agenda
         FROM clin.patient p
         JOIN app.clinic c ON c.id = $1
        WHERE p.birth_date IS NOT NULL
          AND p.deceased_at IS NULL
          AND p.inactivated_at IS NULL
          AND p.merged_into_id IS NULL
          AND extract(month FROM p.birth_date)
              = extract(month FROM app.local_date(clock_timestamp(), c.timezone))
          AND extract(day FROM p.birth_date)
              = extract(day FROM app.local_date(clock_timestamp(), c.timezone))
        ORDER BY p.display_name COLLATE "pt-BR-x-icu"`,
      [ctx.actor.clinicId]);

    return {
      itens: rows.map((x) => ({
        patientId: x.id,
        nome: x.display_name,
        idade: Number(x.idade),
        telefone: x.phone_primary,
        // Quem já vem hoje não precisa de mensagem de parabéns separada — a
        // recepção cumprimenta pessoalmente. Distinguir evita a clínica mandar
        // um WhatsApp automático para quem está na sala de espera.
        temAgendamentoHoje: x.tem_agenda,
      })),
    };
  }));

  r.get('/v1/painel/graficos', {
    schema: {
      querystring: z.object({
        dias: z.coerce.number().int().min(7).max(365).optional(),
      }),
      response: {
        200: z.object({
          atendimentosNoPeriodo: z.array(z.object({
            dia: z.string(), total: z.number().int() })),
          porProcedimento: z.array(z.object({
            rotulo: z.string(), total: z.number().int() })),
          porConvenio: z.array(z.object({
            rotulo: z.string(), total: z.number().int() })),
          duracaoMedia: z.array(z.object({
            rotulo: z.string(), minutos: z.number() })),
          pacientesNovos: z.array(z.object({
            dia: z.string(), total: z.number().int() })),
          distribuicaoEtaria: z.array(z.object({
            faixa: z.string(), total: z.number().int() })),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as { dias?: number };
    const dias = q.dias ?? 30;
    const p = [ctx.actor.clinicId, dias] as const;

    const [serie, procs, convenios, duracoes, novos, etaria] = await Promise.all([
      tx.query<{ dia: string; total: string }>(
        `SELECT a.appointment_date::text AS dia, count(*) AS total
           FROM sched.appointment a
          WHERE a.clinic_id = $1 AND a.status = 'atendido'
            AND a.appointment_date >= (current_date - make_interval(days => $2::int))
          GROUP BY 1 ORDER BY 1`, [...p]),

      tx.query<{ rotulo: string; total: string }>(
        `SELECT coalesce(pr.nome, 'Sem procedimento') AS rotulo, count(*) AS total
           FROM sched.appointment a
           LEFT JOIN sched.procedure pr
                  ON (pr.tenant_id, pr.id) = (a.tenant_id, a.procedure_id)
          WHERE a.clinic_id = $1 AND a.status = 'atendido'
            AND a.appointment_date >= (current_date - make_interval(days => $2::int))
          GROUP BY 1 ORDER BY 2 DESC`, [...p]),

      tx.query<{ rotulo: string; total: string }>(
        // Sem operadora é PARTICULAR, e particular é uma fatia legítima do
        // gráfico — não "sem dados". Agrupar os dois esconderia o mix real de
        // faturamento, que é o que a gestora está olhando aqui.
        `SELECT coalesce(a.operadora_nome, 'Particular') AS rotulo, count(*) AS total
           FROM sched.appointment a
          WHERE a.clinic_id = $1 AND a.status = 'atendido'
            AND a.appointment_date >= (current_date - make_interval(days => $2::int))
          GROUP BY 1 ORDER BY 2 DESC`, [...p]),

      tx.query<{ rotulo: string; minutos: string }>(
        `SELECT coalesce(pr.nome, 'Sem procedimento') AS rotulo,
                round(avg(extract(epoch FROM (a.finished_at - a.started_at)) / 60))
                  AS minutos
           FROM sched.appointment a
           LEFT JOIN sched.procedure pr
                  ON (pr.tenant_id, pr.id) = (a.tenant_id, a.procedure_id)
          WHERE a.clinic_id = $1 AND a.status = 'atendido'
            AND a.started_at IS NOT NULL AND a.finished_at IS NOT NULL
            AND a.appointment_date >= (current_date - make_interval(days => $2::int))
          GROUP BY 1 ORDER BY 2 DESC`, [...p]),

      tx.query<{ dia: string; total: string }>(
        `SELECT app.local_date(p.created_at, c.timezone)::text AS dia, count(*) AS total
           FROM clin.patient p
           JOIN app.clinic c ON c.id = $1
          WHERE p.created_at >= (clock_timestamp() - make_interval(days => $2::int))
            AND p.merged_into_id IS NULL
          GROUP BY 1 ORDER BY 1`, [...p]),

      tx.query<{ faixa: string; total: string }>(
        // Faixas fixas e não quantis: a gestora compara com a faixa do mês
        // passado, e quantil move a fronteira a cada consulta.
        `WITH idades AS (
           SELECT extract(year FROM age(current_date, p.birth_date))::int AS anos
             FROM clin.patient p
            WHERE p.birth_date IS NOT NULL AND p.merged_into_id IS NULL
              AND p.deceased_at IS NULL
         )
         SELECT CASE
                  WHEN anos < 13 THEN '0-12'
                  WHEN anos < 18 THEN '13-17'
                  WHEN anos < 30 THEN '18-29'
                  WHEN anos < 45 THEN '30-44'
                  WHEN anos < 60 THEN '45-59'
                  WHEN anos < 75 THEN '60-74'
                  ELSE '75+'
                END AS faixa,
                count(*) AS total
           FROM idades GROUP BY 1 ORDER BY 1`, []),
    ]);

    const par = (rows: { rotulo: string; total: string }[]) =>
      rows.map((x) => ({ rotulo: x.rotulo, total: Number(x.total) }));
    const serieDe = (rows: { dia: string; total: string }[]) =>
      rows.map((x) => ({ dia: x.dia, total: Number(x.total) }));

    return {
      atendimentosNoPeriodo: serieDe(serie.rows),
      porProcedimento: par(procs.rows),
      porConvenio: par(convenios.rows),
      duracaoMedia: duracoes.rows.map((x) => ({
        rotulo: x.rotulo, minutos: Number(x.minutos) })),
      pacientesNovos: serieDe(novos.rows),
      distribuicaoEtaria: etaria.rows.map((x) => ({
        faixa: x.faixa, total: Number(x.total) })),
    };
  }));
}
