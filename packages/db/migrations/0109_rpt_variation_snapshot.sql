-- 0109_rpt_variation_snapshot.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema app_rpt (security_barrier views) e tabela rpt.variation_snapshot.
-- Design ss3.8: matviews em rpt, propriedade de rpt_owner, SEM GRANT para app_rw.
-- Expostas por views security_barrier em app_rpt com predicado de tenant e papel.

-- ---------------------------------------------------------------------------
-- 1. Schema app_rpt — ja criado pela migration 0104 (rpt_foundations).
--    NÃO recriar aqui. O GRANT USAGE tambem ja foi concedido em 0104.
-- ---------------------------------------------------------------------------
-- CREATE SCHEMA app_rpt removido: ja existe desde 0104_rpt_foundations.sql

-- ---------------------------------------------------------------------------
-- 2. Tabela rpt.variation_snapshot — resultado persistido da decomposicao
-- ---------------------------------------------------------------------------
-- GRANT de fin e sched ao rpt_owner para que a view consiga ler
GRANT USAGE ON SCHEMA fin   TO rpt_owner;
GRANT USAGE ON SCHEMA sched TO rpt_owner;
GRANT SELECT ON fin.entry          TO rpt_owner;
GRANT SELECT ON fin.daily_rollup   TO rpt_owner;
GRANT SELECT ON sched.appointment  TO rpt_owner;
GRANT SELECT ON sched.procedure    TO rpt_owner;

CREATE TABLE rpt.variation_snapshot (
  tenant_id     uuid NOT NULL,
  clinic_id     uuid NOT NULL,
  period_a_start date NOT NULL,
  period_a_end   date NOT NULL,
  period_b_start date NOT NULL,
  period_b_end   date NOT NULL,
  computed_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  factors       jsonb NOT NULL,
  -- factors contem: { volume_cents, mix_procedimento_cents, mix_convenio_cents,
  --                   ticket_cents, faltas_cents, glosas_cents, delta_total_cents,
  --                   detail: { ... } }
  PRIMARY KEY (tenant_id, clinic_id, period_a_start, period_a_end,
               period_b_start, period_b_end)
);
ALTER TABLE rpt.variation_snapshot OWNER TO rpt_owner;

-- jobs precisa inserir/atualizar (computacao agendada ou sob demanda via worker)
GRANT SELECT, INSERT, UPDATE, DELETE ON rpt.variation_snapshot TO jobs;
-- app_rw NAO recebe GRANT na tabela rpt.variation_snapshot (regra ss3.8)

-- ---------------------------------------------------------------------------
-- 3. View security_barrier em app_rpt
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.variation_snapshot WITH (security_barrier = true) AS
  SELECT s.*
    FROM rpt.variation_snapshot s
   WHERE s.tenant_id = app.current_tenant_id()
     AND app.is_member();
ALTER VIEW app_rpt.variation_snapshot OWNER TO rpt_owner;
GRANT SELECT ON app_rpt.variation_snapshot TO app_rw;
