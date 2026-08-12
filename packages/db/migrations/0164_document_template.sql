-- 0164_document_template.sql
-- Tabela de templates de documento por clinica/profissional.
-- Profissional NULL = template vale para toda a clinica.

CREATE TABLE clin.document_template (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id       uuid NOT NULL,
  professional_id uuid,
  kind            text NOT NULL CHECK (kind IN (
    'atestado','declaracao_comparecimento','pedido_exame','relatorio')),
  titulo          text NOT NULL,
  corpo           text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT document_template_clinic_fk
    FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  CONSTRAINT document_template_professional_fk
    FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id)
);

ALTER TABLE clin.document_template OWNER TO app_owner;

REVOKE ALL ON clin.document_template FROM PUBLIC, app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON clin.document_template TO app_rw;

-- RLS
ALTER TABLE clin.document_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.document_template FORCE  ROW LEVEL SECURITY;

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

-- Unique: trata NULL professional_id como igual (coalesce para 0)
CREATE UNIQUE INDEX document_template_kind_uniq
  ON clin.document_template (tenant_id, clinic_id, kind, COALESCE(professional_id, '00000000-0000-0000-0000-000000000000'::uuid));
