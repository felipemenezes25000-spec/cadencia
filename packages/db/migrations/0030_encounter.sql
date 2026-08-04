-- 0030_encounter.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.4 — o agregado do atendimento. O par (tenant_id, patient_id) so existe se o
-- paciente for DESTE tenant: referencia cruzada nao e "invisivel na leitura", e
-- violacao de integridade referencial na escrita (23503).

CREATE TYPE clin.encounter_status AS ENUM
  ('rascunho','finalizado','anulado');

CREATE TABLE clin.encounter (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  appointment_id  uuid,
  occurred_at     timestamptz(3) NOT NULL,
  -- Data do EVENTO no fuso da CLINICA. Toda derivacao diaria usa esta coluna,
  -- nunca occurred_at::date. E o que impede a guia sair com a data errada em
  -- Rio Branco. Gravada na ESCRITA por app.local_date(), nunca recalculada.
  occurred_date   date NOT NULL,
  status          clin.encounter_status NOT NULL DEFAULT 'rascunho',
  head_version_id uuid,       -- cache de leitura, NAO "o registro" (§4.5)
  version_count   int  NOT NULL DEFAULT 0,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id));
ALTER TABLE clin.encounter OWNER TO app_owner;

-- Linha do tempo do paciente (§4.5, alvo < 10 ms): Index Only Scan aqui,
-- nested loop nas versoes vivas. Sem recursao, sem window function, sem DISTINCT ON.
CREATE INDEX ix_encounter_hist
  ON clin.encounter (tenant_id, patient_id, occurred_date DESC, id)
  INCLUDE (professional_id, clinic_id, status, head_version_id);
CREATE INDEX ix_encounter_dia
  ON clin.encounter (tenant_id, clinic_id, occurred_date, professional_id);
CREATE INDEX ix_encounter_agendamento
  ON clin.encounter (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;

-- §3.4: REVOKE UPDATE total. Trocar paciente/profissional/clinica/occurred_at
-- muda o content_hash de toda versao ja selada — por isso nao existe UPDATE
-- para a aplicacao, e a correcao e clin.transfer_encounter (Task 20).
GRANT SELECT, INSERT ON clin.encounter TO app_rw;
GRANT SELECT, INSERT ON clin.encounter TO clin_writer;
GRANT UPDATE (head_version_id, version_count, status) ON clin.encounter TO clin_writer;

ALTER TABLE clin.encounter ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.encounter AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- clin_writer roda dentro de SECURITY DEFINER e continua sujeito a RLS.
CREATE POLICY writer ON clin.encounter AS PERMISSIVE FOR ALL TO clin_writer
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.require_tenant_id());

-- §3.3 segunda camada. RESTRICTIVE faz AND: policy nova nunca abre acesso.
CREATE POLICY clinical_scope ON clin.encounter AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.encounter.tenant_id, clin.encounter.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
