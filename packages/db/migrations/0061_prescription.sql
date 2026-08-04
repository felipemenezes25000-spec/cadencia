-- 0061_prescription.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §7.1 — persistimos do NOSSO lado id, link digital, codigo de
-- desbloqueio, itens NORMALIZADOS, URL do PDF e os BYTES assinados, desde a
-- primeira prescricao. Guardar so o PDF visual com QR que aponta para o dominio
-- do parceiro e ficar refem: dois anos depois, numa acao judicial, o QR nao
-- resolve e nao ha como provar que aquele e o documento assinado.

CREATE TABLE clin.prescription (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  clinic_id       uuid NOT NULL,
  encounter_id    uuid,
  version_id      uuid,
  issued_date     date NOT NULL,
  provider        text NOT NULL,
  provider_prescription_id text NOT NULL,
  patient_link_url text NOT NULL,
  validation_code text NOT NULL,
  pdf_key         uuid,
  pdf_sha256      bytea CHECK (pdf_sha256 IS NULL OR octet_length(pdf_sha256) = 32),
  signature_id    uuid,
  structured_cid  text,
  structured_categoria text,
  cancelled_at    timestamptz(3),
  cancel_reason   text,
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
  CHECK ((pdf_key IS NULL) = (pdf_sha256 IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)));
ALTER TABLE clin.prescription OWNER TO app_owner;

CREATE UNIQUE INDEX ux_prescription_provider
  ON clin.prescription (tenant_id, provider, provider_prescription_id);
CREATE INDEX ix_prescription_paciente
  ON clin.prescription (tenant_id, patient_id, issued_date DESC);
CREATE INDEX ix_prescription_nao_assinada
  ON clin.prescription (tenant_id, clinic_id, created_at)
  WHERE signature_id IS NULL AND cancelled_at IS NULL;

CREATE TABLE clin.prescription_item (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  prescription_id uuid NOT NULL,
  ordinal         int NOT NULL,
  nome            text NOT NULL,
  principio_ativo text,
  concentracao    text,
  forma           text,
  quantidade      text,
  posologia       text NOT NULL,
  eh_controlado   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, prescription_id, ordinal),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, prescription_id) REFERENCES clin.prescription(tenant_id, id));
ALTER TABLE clin.prescription_item OWNER TO app_owner;

CREATE INDEX ix_prescription_item_rx ON clin.prescription_item (tenant_id, prescription_id, ordinal);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescription','prescription_item'] LOOP
    EXECUTE format('REVOKE ALL ON clin.%I FROM PUBLIC, app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT ON clin.%I TO app_rw', t);
    EXECUTE format('CREATE TRIGGER no_mutate BEFORE DELETE ON clin.%I
                      FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation()', t);
    EXECUTE format('ALTER TABLE clin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE clin.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON clin.%I AS PERMISSIVE FOR ALL TO app_rw
        USING (tenant_id = app.current_tenant_id() AND app.is_member())
        WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member())$p$, t);
  END LOOP;
END $$;

GRANT UPDATE (signature_id, pdf_key, pdf_sha256, cancelled_at, cancel_reason,
              version_id, structured_cid, structured_categoria)
  ON clin.prescription TO app_rw;

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, patient_id, professional_id, clinic_id, encounter_id, issued_date,
  provider, provider_prescription_id, patient_link_url, validation_code, created_by
  ON clin.prescription FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE ON clin.prescription_item
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE POLICY clinical_scope ON clin.prescription AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR professional_id = app.current_professional_id()
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.prescription.tenant_id, clin.prescription.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())) );

CREATE POLICY clinical_scope ON clin.prescription_item AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR EXISTS (SELECT 1 FROM clin.prescription r
                      WHERE (r.tenant_id, r.id)
                            = (clin.prescription_item.tenant_id,
                               clin.prescription_item.prescription_id)) );
