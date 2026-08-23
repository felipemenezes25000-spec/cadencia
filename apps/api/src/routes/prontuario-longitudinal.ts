import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const ItemDaLinhaDoTempo = z.object({
  encounterId: z.string().uuid(),
  occurredDate: z.string(),
  status: z.enum(['rascunho', 'finalizado', 'anulado']),
  profissionalNome: z.string(),
  procedimentoNome: z.string().nullable(),
  versionCount: z.number().int(),
  resumoClinico: z.string().nullable(),
  diagnosticos: z.array(z.string()),
  sinaisVitais: z.array(z.string()),
  achados: z.array(z.string()),
  prescricoes: z.number().int(),
  documentos: z.number().int(),
  examesSolicitados: z.number().int(),
  resultadosExames: z.number().int(),
});

/**
 * Leitura longitudinal enriquecida do prontuário.
 *
 * A rota antiga `/prontuario` continua existindo para consumidores legados. Esta
 * rota serve a ficha 360 do cidadão e lê apenas conteúdo SELADO para o histórico:
 * rascunho em andamento aparece como rascunho, mas não vaza dado clínico ainda
 * não finalizado para uma timeline que o usuário interpreta como prontuário.
 */
export async function prontuarioLongitudinalRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/pacientes/:id/prontuario-longitudinal', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      response: {
        200: z.object({ itens: z.array(ItemDaLinhaDoTempo) }),
      },
    },
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const q = req.query as { limit?: number };

    // Registrar ANTES de devolver o conteúdo clínico. A função deduplica a
    // leitura do mesmo caso de uso na janela definida pela trilha.
    await tx.query(`SELECT audit.log_read('patient_timeline', $1)`, [p.id]);

    const { rows } = await tx.query<{
      encounter_id: string;
      occurred_date: string;
      status: 'rascunho' | 'finalizado' | 'anulado';
      profissional_nome: string;
      procedimento_nome: string | null;
      version_count: number;
      resumo_clinico: string | null;
      diagnosticos: string[] | null;
      sinais_vitais: string[] | null;
      achados: string[] | null;
      prescricoes: number;
      documentos: number;
      exames_solicitados: number;
      resultados_exames: number;
    }>(
      `SELECT e.id AS encounter_id,
              e.occurred_date::text AS occurred_date,
              e.status::text AS status,
              coalesce(u.full_name, 'Profissional da unidade') AS profissional_nome,
              proc.nome AS procedimento_nome,
              e.version_count,
              resumo.resumo_clinico,
              coalesce(diag.itens, ARRAY[]::text[]) AS diagnosticos,
              coalesce(obs.itens, ARRAY[]::text[]) AS sinais_vitais,
              coalesce(find.itens, ARRAY[]::text[]) AS achados,
              coalesce(presc.quantidade, 0)::int AS prescricoes,
              coalesce(docs.quantidade, 0)::int AS documentos,
              coalesce(docs.exames, 0)::int AS exames_solicitados,
              coalesce(anx.resultados, 0)::int AS resultados_exames
         FROM clin.encounter e
         LEFT JOIN app.professional pr
                ON (pr.tenant_id, pr.id) = (e.tenant_id, e.professional_id)
         LEFT JOIN id."user" u ON u.id = pr.user_id
         LEFT JOIN sched.appointment ag
                ON (ag.tenant_id, ag.id) = (e.tenant_id, e.appointment_id)
         LEFT JOIN sched.procedure proc
                ON (proc.tenant_id, proc.id) = (ag.tenant_id, ag.procedure_id)
         LEFT JOIN LATERAL (
              SELECT left(nullif(btrim(string_agg(v.value_text, E'\n' ORDER BY s.version_no, v.ordinal)), ''), 2000)
                       AS resumo_clinico
                FROM clin.v_version_status s
                JOIN clin.encounter_field_value v
                  ON (v.tenant_id, v.version_id) = (s.tenant_id, s.id)
                JOIN clin.record_field f
                  ON (f.tenant_id, f.id) = (v.tenant_id, v.field_id)
               WHERE s.encounter_id = e.id
                 AND NOT s.superseded
                 AND f.code = 'evolucao'
                 AND v.purged_at IS NULL
                 AND nullif(btrim(v.value_text), '') IS NOT NULL
         ) resumo ON true
         LEFT JOIN LATERAL (
              SELECT array_agg(
                       concat(d.code_system, ' ', d.code, ' — ', d.display_snapshot)
                       ORDER BY d.is_principal DESC, d.code_system, d.code) AS itens
                FROM clin.diagnosis d
               WHERE d.encounter_id = e.id AND d.live
         ) diag ON true
         LEFT JOIN LATERAL (
              SELECT array_agg(
                       concat(o.observation_code, ': ', o.value_num::text,
                              CASE WHEN nullif(o.unit, '') IS NULL THEN '' ELSE ' ' || o.unit END)
                       ORDER BY o.observation_code, o.component_ordinal) AS itens
                FROM clin.observation o
               WHERE o.encounter_id = e.id AND o.live
         ) obs ON true
         LEFT JOIN LATERAL (
              SELECT array_agg(f.display_snapshot ORDER BY f.field_code, f.ordinal) AS itens
                FROM clin.encounter_finding f
               WHERE f.encounter_id = e.id AND f.live
         ) find ON true
         LEFT JOIN LATERAL (
              SELECT count(*)::int AS quantidade
                FROM clin.prescription p2
               WHERE p2.encounter_id = e.id AND p2.cancelled_at IS NULL
         ) presc ON true
         LEFT JOIN LATERAL (
              SELECT count(*)::int AS quantidade,
                     count(*) FILTER (WHERE d.kind = 'pedido_exame')::int AS exames
                FROM clin.document d
               WHERE d.encounter_id = e.id
         ) docs ON true
         LEFT JOIN LATERAL (
              SELECT count(*) FILTER (WHERE a.kind = 'resultado_exame' AND a.purged_at IS NULL)::int
                       AS resultados
                FROM clin.attachment a
               WHERE a.encounter_id = e.id
         ) anx ON true
        WHERE e.patient_id = $1
        ORDER BY e.occurred_date DESC, e.created_at DESC
        LIMIT $2`,
      [p.id, q.limit ?? 100],
    );

    return {
      itens: rows.map((x) => ({
        encounterId: x.encounter_id,
        occurredDate: x.occurred_date,
        status: x.status,
        profissionalNome: x.profissional_nome,
        procedimentoNome: x.procedimento_nome,
        versionCount: x.version_count,
        resumoClinico: x.resumo_clinico,
        diagnosticos: x.diagnosticos ?? [],
        sinaisVitais: x.sinais_vitais ?? [],
        achados: x.achados ?? [],
        prescricoes: x.prescricoes,
        documentos: x.documentos,
        examesSolicitados: x.exames_solicitados,
        resultadosExames: x.resultados_exames,
      })),
    };
  }));
}
