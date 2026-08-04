-- 0056_document.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §7 e §3.11 — documento NATO-DIGITAL: o objeto canonico e a verdade, o PDF e
-- uma renderizacao. Por isso content_hash e signature_id sao do documento, e
-- pdf_key/pdf_sha256 apenas registram qual renderizacao foi entregue.

CREATE TYPE clin.document_kind AS ENUM
  ('atestado','pedido_exame','relatorio','declaracao_comparecimento');

CREATE TABLE clin.document (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  kind            clin.document_kind NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  encounter_id    uuid,
  version_id      uuid,
  issued_date     date NOT NULL,
  payload         jsonb NOT NULL,
  content_hash    bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  canonical_version text NOT NULL,
  signature_id    uuid,
  pdf_key         uuid,
  pdf_sha256      bytea CHECK (pdf_sha256 IS NULL OR octet_length(pdf_sha256) = 32),
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)       REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id)    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)      REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_id)    REFERENCES clin.signature(tenant_id, id),
  CHECK ((pdf_key IS NULL) = (pdf_sha256 IS NULL)));
ALTER TABLE clin.document OWNER TO app_owner;

CREATE INDEX ix_document_paciente
  ON clin.document (tenant_id, patient_id, issued_date DESC);
CREATE INDEX ix_document_sem_assinatura
  ON clin.document (tenant_id, clinic_id, created_at) WHERE signature_id IS NULL;

REVOKE ALL ON clin.document FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.document TO app_rw;
GRANT UPDATE (signature_id, pdf_key, pdf_sha256) ON clin.document TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.document
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, kind, patient_id, professional_id, clinic_id, encounter_id,
  version_id, issued_date, payload, content_hash, canonical_version, created_by
  ON clin.document FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.document FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.document AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.document AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.document.tenant_id, clin.document.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );
