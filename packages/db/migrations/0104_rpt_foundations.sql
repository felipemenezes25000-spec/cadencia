-- packages/db/migrations/0104_rpt_foundations.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Fundacoes do relatorio: schema app_rpt, BYPASSRLS para rpt_owner,
-- GRANTs nas tabelas-fonte e tabela de log de refresh.

-- ---------------------------------------------------------------------------
-- 1. app_owner precisa ser membro de rpt_owner para SET ROLE nas migrations
--    seguintes (analogo ao GRANT audit_owner TO app_owner da 0001).
-- ---------------------------------------------------------------------------
GRANT rpt_owner TO app_owner;

-- ---------------------------------------------------------------------------
-- 2. rpt_owner precisa de BYPASSRLS por DUAS razoes:
--    (a) REFRESH MATERIALIZED VIEW executa a query definidora com os privilegios
--        do DONO da matview (rpt_owner). As tabelas-fonte (clin.encounter, etc.)
--        tem RLS FORCE com policies TO app_rw. Sem BYPASSRLS, rpt_owner ve
--        zero linhas e a matview nasce vazia.
--    (b) As views security_barrier em app_rpt, pertencentes a rpt_owner, chamam
--        app.is_member() e app.clinical_scope_all(). Essas funcoes consultam
--        app.membership, que tem RLS FORCE com policy TO app_rw. Sem BYPASSRLS,
--        as funcoes retornam false e a view filtra tudo.
--    rpt_owner e NOLOGIN: ninguem abre conexao com ele. O unico acesso e por
--    SET ROLE (requer membership) e SECURITY DEFINER.
-- ---------------------------------------------------------------------------
ALTER ROLE rpt_owner BYPASSRLS;

-- ---------------------------------------------------------------------------
-- 3. Schema app_rpt — camada de leitura (views security_barrier) entre rpt e
--    app_rw. Pertence a rpt_owner para que as views possam ler as matviews
--    (que nao tem GRANT para ninguem alem do dono).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_rpt AUTHORIZATION rpt_owner;

-- ---------------------------------------------------------------------------
-- 4. GRANT USAGE nos schemas-fonte para rpt_owner
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA clin, fin, sched, msg TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 5. GRANT SELECT nas tabelas-fonte para rpt_owner. Cada tabela e listada
--    explicitamente — DEFAULT PRIVILEGES NAO substitui (§3.13 item 7).
-- ---------------------------------------------------------------------------

-- clin: atendimentos, versoes, diagnosticos, procedimentos, pacientes
GRANT SELECT ON clin.encounter          TO rpt_owner;
GRANT SELECT ON clin.encounter_version  TO rpt_owner;
GRANT SELECT ON clin.diagnosis          TO rpt_owner;
GRANT SELECT ON clin.procedure          TO rpt_owner;
GRANT SELECT ON clin.patient            TO rpt_owner;

-- fin: lancamentos, categorias, metodos de pagamento, contas, centros de custo
GRANT SELECT ON fin.entry               TO rpt_owner;
GRANT SELECT ON fin.category            TO rpt_owner;
GRANT SELECT ON fin.payment_method      TO rpt_owner;
GRANT SELECT ON fin.bank_account        TO rpt_owner;
GRANT SELECT ON fin.cost_center         TO rpt_owner;

-- sched: agendamentos
GRANT SELECT ON sched.appointment       TO rpt_owner;

-- msg: respostas NPS
GRANT SELECT ON msg.nps_response        TO rpt_owner;

-- app: membership e professional (necessarias para funcoes de escopo nas views)
GRANT SELECT ON app.membership          TO rpt_owner;
GRANT SELECT ON app.professional        TO rpt_owner;
GRANT SELECT ON app.clinic              TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 6. rpt.refresh_log — carimbo "dados ate HH:MM" (§3.8).
--    Tabela GLOBAL (sem tenant_id): um unico refresh cobre todos os tenants.
--    rpt_owner e dono (schema rpt AUTHORIZATION rpt_owner).
-- ---------------------------------------------------------------------------
SET ROLE rpt_owner;

CREATE TABLE rpt.refresh_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matview_name   text NOT NULL,
  started_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at    timestamptz(3),
  row_count      bigint,
  success        boolean NOT NULL DEFAULT true,
  error_message  text
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. GRANTs de infra: jobs precisa operar o refresh; app_rw precisa ler o log
--    para exibir "dados ate HH:MM" no front.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA rpt TO jobs;
GRANT SELECT, INSERT, UPDATE ON rpt.refresh_log TO jobs;

GRANT USAGE ON SCHEMA app_rpt TO app_rw, app_support;
GRANT SELECT ON rpt.refresh_log TO app_rw;
