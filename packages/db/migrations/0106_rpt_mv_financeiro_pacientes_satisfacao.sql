-- 0106_rpt_mv_financeiro_pacientes_satisfacao.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Matviews financeiro, pacientes e satisfacao. Propriedade de rpt_owner,
-- SEM GRANT para app_rw. bank_account_id e cost_center_id vem de fin.entry
-- (adicionados pela migration 0087 do bloco 01-fin-contas-centro).

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. rpt.mv_financeiro — um registro por lancamento financeiro.
--    category e method sao nomes textuais (JOIN), nao IDs.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_financeiro AS
SELECT
  e.id                          AS entry_id,
  e.kind::text                  AS kind,
  c.name                        AS category,
  pm.name                       AS method,
  e.amount_cents,
  e.paid_at,
  e.due_date,
  e.status::text                AS status,
  e.professional_id,
  e.clinic_id,
  e.bank_account_id,
  e.cost_center_id,
  e.tenant_id
FROM fin.entry e
LEFT JOIN fin.category c
  ON c.tenant_id = e.tenant_id AND c.id = e.category_id
LEFT JOIN fin.payment_method pm
  ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_financeiro
  ON rpt.mv_financeiro (tenant_id, entry_id);
CREATE INDEX ix_mv_financeiro_data
  ON rpt.mv_financeiro (tenant_id, clinic_id, paid_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 2. rpt.mv_pacientes — um registro por paciente com metricas de visita.
--    Faixa etaria calculada a partir de birth_date. Gender usa sex_at_birth.
--    source e NULL ate que o campo de origem de captacao exista no cadastro.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_pacientes AS
SELECT
  p.id                          AS patient_id,
  CASE
    WHEN p.birth_date IS NULL              THEN 'desconhecido'
    WHEN age(p.birth_date) < interval '1 year'    THEN '0-1'
    WHEN age(p.birth_date) < interval '13 years'  THEN '2-12'
    WHEN age(p.birth_date) < interval '18 years'  THEN '13-17'
    WHEN age(p.birth_date) < interval '30 years'  THEN '18-29'
    WHEN age(p.birth_date) < interval '45 years'  THEN '30-44'
    WHEN age(p.birth_date) < interval '60 years'  THEN '45-59'
    WHEN age(p.birth_date) < interval '75 years'  THEN '60-74'
    ELSE                                            '75+'
  END                           AS age_bracket,
  COALESCE(p.sex_at_birth, 'I') AS gender,
  NULL::text                    AS source,
  vis.first_visit,
  vis.last_visit,
  COALESCE(vis.visit_count, 0)  AS visit_count,
  p.tenant_id
FROM clin.patient p
LEFT JOIN LATERAL (
  SELECT
    MIN(a.appointment_date) AS first_visit,
    MAX(a.appointment_date) AS last_visit,
    COUNT(*)::int           AS visit_count
  FROM sched.appointment a
  WHERE a.tenant_id = p.tenant_id
    AND a.patient_id = p.id
    AND a.status = 'atendido'
) vis ON true
WHERE p.inactivated_at IS NULL
  AND p.merged_into_id IS NULL
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_pacientes
  ON rpt.mv_pacientes (tenant_id, patient_id);
CREATE INDEX ix_mv_pacientes_faixa
  ON rpt.mv_pacientes (tenant_id, age_bracket);

-- ---------------------------------------------------------------------------
-- 3. rpt.mv_satisfacao — um registro por resposta NPS.
--    Categoria NPS: promoter (9-10), passive (7-8), detractor (0-6).
--    professional_id e clinic_id vem do agendamento vinculado (nullable).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW rpt.mv_satisfacao AS
SELECT
  nps.id                        AS nps_response_id,
  nps.score,
  CASE
    WHEN nps.score >= 9 THEN 'promoter'
    WHEN nps.score >= 7 THEN 'passive'
    ELSE                      'detractor'
  END                           AS category,
  a.professional_id,
  a.clinic_id,
  nps.received_at               AS responded_at,
  nps.tenant_id
FROM msg.nps_response nps
LEFT JOIN sched.appointment a
  ON a.tenant_id = nps.tenant_id AND a.id = nps.appointment_id
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_satisfacao
  ON rpt.mv_satisfacao (tenant_id, nps_response_id);
CREATE INDEX ix_mv_satisfacao_data
  ON rpt.mv_satisfacao (tenant_id, responded_at DESC);

RESET ROLE;
