-- LGPD compliance: consent management + data portability requests
--
-- Art. 7 LGPD: bases legais de tratamento. Em saude, o tratamento de dados
-- pessoais de pacientes tem base na "tutela da saude" (art. 7, VIII) e no
-- "cumprimento de obrigacao legal" (art. 7, II — prontuario medico por 20 anos,
-- CFM 1821/2007). Consentimento explicito LGPD e exigido para:
--   - comunicacoes de marketing
--   - compartilhamento com terceiros (pesquisa, laboratorios parceiros)
--   - uso de dados para IA/analytics alem do estritamente assistencial
--
-- Art. 18: direitos do titular — portabilidade, acesso, correcao, eliminacao
-- (limitada em saude pelo dever de guarda).

BEGIN;

CREATE TYPE app.lgpd_consent_purpose AS ENUM (
  'marketing',
  'pesquisa',
  'compartilhamento_terceiros',
  'ia_analytics'
);

CREATE TYPE app.lgpd_request_type AS ENUM (
  'portabilidade',
  'acesso',
  'eliminacao'
);

CREATE TYPE app.lgpd_request_status AS ENUM (
  'pendente',
  'em_andamento',
  'concluido',
  'recusado'
);

CREATE TABLE app.lgpd_consent (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES app.tenant(id),
  patient_id      uuid        NOT NULL REFERENCES app.patient(id),
  purpose         app.lgpd_consent_purpose NOT NULL,
  granted         boolean     NOT NULL DEFAULT false,
  granted_at      timestamptz,
  revoked_at      timestamptz,
  collected_by    uuid        REFERENCES ident.usuario(id),
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX lgpd_consent_unique_active
  ON app.lgpd_consent (tenant_id, patient_id, purpose)
  WHERE revoked_at IS NULL;

ALTER TABLE app.lgpd_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_consent_tenant ON app.lgpd_consent
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON app.lgpd_consent TO cadencia_app;

CREATE TABLE app.lgpd_data_request (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES app.tenant(id),
  patient_id      uuid        NOT NULL REFERENCES app.patient(id),
  request_type    app.lgpd_request_type NOT NULL,
  status          app.lgpd_request_status NOT NULL DEFAULT 'pendente',
  requested_by    uuid        NOT NULL REFERENCES ident.usuario(id),
  processed_by    uuid        REFERENCES ident.usuario(id),
  justification   text,
  response_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '15 days',
  PRIMARY KEY (id)
);

ALTER TABLE app.lgpd_data_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_data_request_tenant ON app.lgpd_data_request
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON app.lgpd_data_request TO cadencia_app;

-- Audit keys for LGPD events
INSERT INTO audit.event_meta (key, label_pt) VALUES
  ('LGPD_CONSENT_GRANTED',   'Consentimento LGPD concedido'),
  ('LGPD_CONSENT_REVOKED',   'Consentimento LGPD revogado'),
  ('LGPD_DATA_REQUEST',      'Solicitacao de direito LGPD'),
  ('LGPD_DATA_REQUEST_DONE', 'Solicitacao LGPD concluida')
ON CONFLICT (key) DO NOTHING;

COMMIT;
