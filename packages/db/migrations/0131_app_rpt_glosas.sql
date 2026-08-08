-- 0131_app_rpt_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — view security_barrier em app_rpt para expor dados de
-- glosa ao modulo reports. Segue o padrao de 0108_app_rpt_barrier_views.sql:
-- rpt_owner e dono, app_rw le, matview nunca recebe GRANT direto.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- app_rpt.glosas — dado financeiro de glosa, sem restricao de escopo clinico.
-- Inclui data_atendimento para filtragem por periodo na variacao.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.glosas WITH (security_barrier = true) AS
  SELECT m.glosa_id, m.valor_glosado_cents, m.data_atendimento,
         m.operadora_id, m.professional_id, m.clinic_id,
         m.glosa_created_at
    FROM rpt.mv_glosas m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANT: app_rw le a view, nunca a matview diretamente.
-- ---------------------------------------------------------------------------
GRANT SELECT ON app_rpt.glosas TO app_rw;
