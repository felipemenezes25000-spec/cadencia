-- 0058_record_export.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.12 — a exportacao ECF.18 e uma ENTIDADE. version_ids e attachment_ids
-- congelam o CONJUNTO exportado: sem isso, o paciente volta em seis meses
-- dizendo que faltou um exame e nao ha com o que comparar.

CREATE TABLE clin.record_export (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  patient_id    uuid NOT NULL,
  requested_by  uuid NOT NULL,
  requester_kind text NOT NULL CHECK (requester_kind IN
    ('titular','representante','profissional','judicial','fiscalizacao')),
  requester_note text,
  period_from   date, period_to date,
  version_ids    uuid[] NOT NULL,
  attachment_ids uuid[] NOT NULL,
  document_ids   uuid[] NOT NULL,
  page_count    int NOT NULL CHECK (page_count > 0),
  pdf_key       uuid NOT NULL,
  pdf_sha256    bytea NOT NULL CHECK (octet_length(pdf_sha256) = 32),
  receipt_json  jsonb NOT NULL,
  duration_ms   int,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from));
ALTER TABLE clin.record_export OWNER TO app_owner;

CREATE INDEX ix_record_export_paciente
  ON clin.record_export (tenant_id, patient_id, created_at DESC);

REVOKE ALL ON clin.record_export FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.record_export TO app_rw;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON clin.record_export
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.record_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_export FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_export AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.record_export AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.record_export.tenant_id, clin.record_export.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
