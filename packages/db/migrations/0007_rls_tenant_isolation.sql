-- 0007_rls_tenant_isolation.sql
-- Fase 0 · design §3.3 — a policy PERMISSIVE e os GRANTs, tabela a tabela.
--
-- §3.13 item 7: privilegio e AFIRMADO tabela a tabela. ALTER DEFAULT PRIVILEGES
-- nao substitui a assercao: tabela nova com policy correta e sem GRANT da 500
-- na primeira recepcionista as 8h, e o alarme global de rollback nao dispara.

GRANT SELECT                          ON app.tenant       TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.clinic       TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.membership   TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.professional TO app_rw;
GRANT SELECT                          ON id."user"        TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON clin.patient     TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE  ON clin.patient_identifier TO app_rw;
-- clin.patient nao recebe DELETE: paciente sai de circulacao por inactivated_at.

-- ---------------------------------------------------------------------------
-- app.tenant — a coluna de tenant e o proprio id.
-- ---------------------------------------------------------------------------
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenant AS PERMISSIVE FOR ALL TO app_rw
  USING      (id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- app.membership — RAIZ DA CONFIANCA.
-- A policy NAO pode chamar app.is_member(): is_member() le esta tabela, e o
-- planejador aborta com "infinite recursion detected in policy for relation".
-- A protecao equivalente vem do proprio predicado: so o dono do vinculo le o
-- vinculo. Um contexto forjado (tenant B com user A) nao encontra linha nenhuma,
-- e por isso app.is_member() devolve false — que e exatamente o teste T6.
-- Listar a equipe (visao de admin) e Fase 1, por funcao SECURITY DEFINER propria.
-- WITH CHECK nao restringe user_id porque o onboarding cria vinculo de terceiros;
-- por isso o INSERT de vinculo alheio nao pode usar RETURNING.
-- ---------------------------------------------------------------------------
ALTER TABLE app.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.membership AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.require_tenant_id());

-- ---------------------------------------------------------------------------
-- Demais tabelas: o padrao literal da §3.3.
-- ---------------------------------------------------------------------------
ALTER TABLE app.clinic ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinic FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.clinic AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.professional ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.professional FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.professional AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE clin.patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.patient AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())   -- 0 linhas se ausente
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());  -- excecao se ausente

ALTER TABLE clin.patient_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient_identifier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.patient_identifier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
