-- packages/db/migrations/0108_app_rpt_barrier_views.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Views security_barrier em app_rpt. Cada view filtra por tenant e papel.
-- NAO sao security_invoker: executam com privilegios de rpt_owner (BYPASSRLS),
-- que e o unico papel com SELECT nas matviews. A barreira de seguranca vem do
-- predicado security_barrier no WHERE, avaliado ANTES de qualquer condicao do
-- usuario, impedindo vazamento por erro ou side channel.
--
-- Os GUC (app.tenant_id, app.user_id, etc.) sao definidos por withTenantTx no
-- preambulo da transacao e sao visiveis dentro da view independente do papel.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- 1. app_rpt.atendimentos — §3.8 literal. Dado clinico: verifica clinical_scope.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.atendimentos WITH (security_barrier = true) AS
  SELECT m.encounter_id, m.patient_id, m.professional_id, m.clinic_id,
         m.occurred_date, m.duration_minutes, m.procedure_codes,
         m.diagnosis_codes, m.version_count, m.status
    FROM rpt.mv_atendimentos m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member()
     AND (app.clinical_scope_all()
          OR m.professional_id = app.current_professional_id());

-- ---------------------------------------------------------------------------
-- 2. app_rpt.financeiro — dado financeiro, sem restricao de escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.financeiro WITH (security_barrier = true) AS
  SELECT m.entry_id, m.kind, m.category, m.method, m.amount_cents,
         m.paid_at, m.due_date, m.status, m.professional_id, m.clinic_id,
         m.bank_account_id, m.cost_center_id
    FROM rpt.mv_financeiro m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 3. app_rpt.agenda — dado administrativo, sem restricao de escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.agenda WITH (security_barrier = true) AS
  SELECT m.appointment_date, m.professional_id, m.clinic_id,
         m.total_slots, m.booked, m.confirmed, m.attended,
         m.no_shows, m.cancelled, m.occupancy_pct
    FROM rpt.mv_agenda m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 4. app_rpt.pacientes — dado clinico: verifica clinical_scope quando o
--    profissional nao tem escopo total.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.pacientes WITH (security_barrier = true) AS
  SELECT m.patient_id, m.age_bracket, m.gender, m.source,
         m.first_visit, m.last_visit, m.visit_count
    FROM rpt.mv_pacientes m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

-- ---------------------------------------------------------------------------
-- 5. app_rpt.satisfacao — dado administrativo (NPS), sem escopo clinico.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.satisfacao WITH (security_barrier = true) AS
  SELECT m.nps_response_id, m.score, m.category, m.professional_id,
         m.clinic_id, m.responded_at
    FROM rpt.mv_satisfacao m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANTs: app_rw le as views, nunca as matviews diretamente.
-- ---------------------------------------------------------------------------
GRANT SELECT ON app_rpt.atendimentos  TO app_rw;
GRANT SELECT ON app_rpt.financeiro    TO app_rw;
GRANT SELECT ON app_rpt.agenda        TO app_rw;
GRANT SELECT ON app_rpt.pacientes     TO app_rw;
GRANT SELECT ON app_rpt.satisfacao    TO app_rw;
