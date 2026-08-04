-- 0057_attachment.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §10 item 14 — NGS1.06.01: o nome do objeto NAO revela conteudo.
-- storage_key e UUIDv7 opaco, sem extensao; o nome original mora no banco, sob
-- RLS. dek_ref e a referencia da chave de dados: expurgo de midia imutavel nao
-- tem outro caminho alem de destruir a chave (crypto-shredding).

CREATE TYPE clin.attachment_kind AS ENUM
  ('resultado_exame','imagem','documento_externo','consentimento','outro');

CREATE TABLE clin.attachment (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  patient_id   uuid NOT NULL,
  encounter_id uuid,
  version_id   uuid,
  kind         clin.attachment_kind NOT NULL DEFAULT 'outro',
  storage_key  uuid NOT NULL,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
  sha256       bytea NOT NULL CHECK (octet_length(sha256) = 32),
  dek_ref      text NOT NULL,
  occurred_date date,
  purged_at    timestamptz(3),
  created_by   uuid NOT NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storage_key),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id));
ALTER TABLE clin.attachment OWNER TO app_owner;

CREATE INDEX ix_attachment_paciente
  ON clin.attachment (tenant_id, patient_id, occurred_date DESC NULLS LAST, id);
CREATE INDEX ix_attachment_sem_versao
  ON clin.attachment (tenant_id, created_at)
  WHERE version_id IS NULL AND kind = 'resultado_exame';

REVOKE ALL ON clin.attachment FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.attachment TO app_rw;
GRANT UPDATE (encounter_id, version_id, kind, occurred_date) ON clin.attachment TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.attachment
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, patient_id, storage_key, original_name, content_type,
  size_bytes, sha256, dek_ref, created_by
  ON clin.attachment FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.attachment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.attachment AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY clinical_scope ON clin.attachment AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.attachment.tenant_id, clin.attachment.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp()))
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.attachment.tenant_id, clin.attachment.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
