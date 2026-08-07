-- packages/db/migrations/0105_rpt_mv_atendimentos_agenda.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Matviews de atendimentos e agenda. Propriedade de rpt_owner, SEM GRANT
-- para app_rw. Exposicao exclusiva via app_rpt (migration futura).

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. rpt.mv_atendimentos — um registro por atendimento nao-anulado.
--    Diagnoses e procedimentos vivos sao agregados em arrays para filtro.
--    Duracao em minutos vem do agendamento vinculado (se houver).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_atendimentos AS
SELECT
  e.id                    AS encounter_id,
  e.patient_id,
  e.professional_id,
  e.clinic_id,
  e.occurred_date,
  CASE WHEN a.id IS NOT NULL THEN
    (EXTRACT(EPOCH FROM (COALESCE(a.finished_at, a.ends_at) - a.starts_at)) / 60)::int
  END                     AS duration_minutes,
  COALESCE(proc.codes, ARRAY[]::text[])  AS procedure_codes,
  COALESCE(diag.codes, ARRAY[]::text[])  AS diagnosis_codes,
  e.version_count,
  e.status::text          AS status,
  e.tenant_id
FROM clin.encounter e
LEFT JOIN sched.appointment a
  ON a.tenant_id = e.tenant_id AND a.id = e.appointment_id
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT p.code ORDER BY p.code) AS codes
    FROM clin.procedure p
   WHERE p.tenant_id = e.tenant_id
     AND p.encounter_id = e.id
     AND p.live
) proc ON true
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT d.code ORDER BY d.code) AS codes
    FROM clin.diagnosis d
   WHERE d.tenant_id = e.tenant_id
     AND d.encounter_id = e.id
     AND d.live
) diag ON true
WHERE e.status <> 'anulado'
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_atendimentos
  ON rpt.mv_atendimentos (tenant_id, encounter_id);
CREATE INDEX ix_mv_atendimentos_data
  ON rpt.mv_atendimentos (tenant_id, clinic_id, occurred_date DESC);

-- ---------------------------------------------------------------------------
-- 2. rpt.mv_agenda — resumo diario por profissional e clinica.
--    Ocupacao = atendidos / agendados nao-cancelados (show rate).
--    total_slots = todos os agendamentos criados para o dia.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_agenda AS
SELECT
  a.appointment_date,
  a.professional_id,
  a.clinic_id,
  COUNT(*)::int                                                     AS total_slots,
  COUNT(*) FILTER (WHERE a.status <> 'cancelado')::int              AS booked,
  COUNT(*) FILTER (WHERE a.confirmed_at IS NOT NULL
                     AND a.status <> 'cancelado')::int              AS confirmed,
  COUNT(*) FILTER (WHERE a.status = 'atendido')::int                AS attended,
  COUNT(*) FILTER (WHERE a.status = 'faltou')::int                  AS no_shows,
  COUNT(*) FILTER (WHERE a.status = 'cancelado')::int               AS cancelled,
  CASE
    WHEN COUNT(*) FILTER (WHERE a.status <> 'cancelado') > 0 THEN
      (COUNT(*) FILTER (WHERE a.status = 'atendido')::numeric
       / COUNT(*) FILTER (WHERE a.status <> 'cancelado') * 100)::smallint
    ELSE 0::smallint
  END                                                               AS occupancy_pct,
  a.tenant_id
FROM sched.appointment a
GROUP BY a.tenant_id, a.appointment_date, a.professional_id, a.clinic_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_agenda
  ON rpt.mv_agenda (tenant_id, appointment_date, professional_id, clinic_id);
CREATE INDEX ix_mv_agenda_data
  ON rpt.mv_agenda (tenant_id, clinic_id, appointment_date DESC);

RESET ROLE;
