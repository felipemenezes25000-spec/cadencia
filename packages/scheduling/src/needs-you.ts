import type { TxClient } from '@cadencia/db';

export interface NeedsYou {
  readonly confirmacoesSemResposta: number;
  readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number;
  readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

/**
 * §5.3 — o painel "Precisa de voce" de Hoje. Cinco filas de trabalho, contadas
 * ao vivo. Cada uma existe porque e uma pendencia que hoje mora na cabeca de
 * alguem: o produto so e util se ela sair de la.
 *
 * `prescricoesNaoAssinadas` e `resultadosChegados` sao zero ate a Task 53/47
 * criarem clin.prescription e clin.attachment — o campo existe desde agora para
 * que a tela nao mude de forma.
 */
export async function needsYou(
  tx: TxClient, q: { clinicId: string; professionalId?: string },
): Promise<NeedsYou> {
  const { rows } = await tx.query<{
    confirmacoes: string; prescricoes: string; resultados: string;
    rascunhos: string; guias: string }>(
    `WITH tz AS (
       SELECT c.timezone FROM app.clinic c WHERE c.id = $1
     )
     SELECT
       (SELECT count(*) FROM sched.appointment a
         WHERE a.clinic_id = $1 AND a.status = 'agendado'
           AND a.starts_at BETWEEN clock_timestamp()
                               AND clock_timestamp() + interval '48 hours'
           AND ($2::uuid IS NULL OR a.professional_id = $2::uuid)) AS confirmacoes,
       0 AS prescricoes,
       (SELECT count(*) FROM clin.attachment att
         WHERE att.kind = 'resultado_exame'
           AND att.version_id IS NULL
           AND EXISTS (SELECT 1 FROM clin.encounter e
                        WHERE (e.tenant_id, e.id) = (att.tenant_id, att.encounter_id)
                          AND e.clinic_id = $1
                          AND ($2::uuid IS NULL OR e.professional_id = $2::uuid))) AS resultados,
       (SELECT count(*) FROM clin.encounter_draft d
          JOIN clin.encounter e ON (e.tenant_id, e.id) = (d.tenant_id, d.encounter_id)
         WHERE e.clinic_id = $1 AND e.status = 'rascunho'
           AND e.occurred_date < app.local_date(clock_timestamp(), (SELECT timezone FROM tz))
           AND ($2::uuid IS NULL OR e.professional_id = $2::uuid)) AS rascunhos,
       (SELECT count(*) FROM clin.encounter_billing b
          JOIN clin.encounter e ON (e.tenant_id, e.id) = (b.tenant_id, b.encounter_id)
         WHERE e.clinic_id = $1 AND b.registro_ans IS NOT NULL
           AND e.status = 'finalizado') AS guias`,
    [q.clinicId, q.professionalId ?? null]);

  const r = rows[0];
  return {
    confirmacoesSemResposta: Number(r?.confirmacoes ?? 0),
    prescricoesNaoAssinadas: Number(r?.prescricoes ?? 0),
    resultadosChegados: Number(r?.resultados ?? 0),
    rascunhosDeOntem: Number(r?.rascunhos ?? 0),
    guiasAFaturar: Number(r?.guias ?? 0),
  };
}
