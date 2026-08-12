-- 0164_document_template.sql
-- Tabela de templates de documento por clinica/profissional.
-- Profissional NULL = template vale para toda a clinica.

CREATE TABLE clin.document_template (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES auth.tenant(id),
  clinic_id       uuid NOT NULL REFERENCES app.clinic(id),
  professional_id uuid REFERENCES app.professional(id),
  kind            text NOT NULL CHECK (kind IN (
    'atestado','declaracao_comparecimento','pedido_exame','relatorio')),
  titulo          text NOT NULL,
  corpo           text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT document_template_kind_uniq
    UNIQUE (tenant_id, clinic_id, professional_id, kind)
);

ALTER TABLE clin.document_template OWNER TO app_owner;

REVOKE ALL ON clin.document_template FROM PUBLIC, app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON clin.document_template TO app_rw;

-- RLS
ALTER TABLE clin.document_template ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY document_template_tenant ON clin.document_template
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY document_template_clinic ON clin.document_template
    FOR ALL USING (clinic_id = current_setting('app.clinic_id')::uuid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
