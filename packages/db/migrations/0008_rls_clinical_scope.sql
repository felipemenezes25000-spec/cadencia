-- 0008_rls_clinical_scope.sql
-- Fase 0 · design §3.3, segunda camada. RESTRICTIVE faz AND com as permissivas:
-- policy nova nunca "abre" acesso.

CREATE TABLE clin.record_share (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL,
  patient_id uuid NOT NULL,
  grantee_professional_id uuid NOT NULL,
  granted_by_professional_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  granted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, grantee_professional_id)
    REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by_professional_id)
    REFERENCES app.professional(tenant_id, id));
ALTER TABLE clin.record_share OWNER TO app_owner;

CREATE INDEX ix_record_share_vigente
  ON clin.record_share (tenant_id, patient_id, grantee_professional_id)
  WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.record_share TO app_rw;

ALTER TABLE clin.record_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_share FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.record_share AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE POLICY clinical_scope ON clin.record_share AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR grantee_professional_id = app.current_professional_id()
          OR granted_by_professional_id = app.current_professional_id() );

-- ---------------------------------------------------------------------------
-- clin.patient_identifier: CPF, CNS e carteirinha sao o eixo do escopo clinico.
-- Tres ramos, todos STABLE (o planejador avalia os dois primeiros uma unica vez):
--   1. papel de escopo total no tenant (admin_clinico / diretor_tecnico);
--   2. quem NAO e profissional — recepcao e financeiro precisam do CPF para
--      cobrar, e o ator 'system' do worker cai aqui tambem;
--   3. profissional com compartilhamento vigente para aquele paciente.
-- clin.patient NAO recebe policy RESTRICTIVE: e cadastro, nao prontuario (§10.18).
-- ---------------------------------------------------------------------------
CREATE POLICY clinical_scope ON clin.patient_identifier
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.patient_identifier.tenant_id,
                               clin.patient_identifier.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
