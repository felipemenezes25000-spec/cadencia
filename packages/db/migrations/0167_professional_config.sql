-- 0167_professional_config.sql
-- Configuracao por profissional: especialidade, RP, CBO, preferencias de documento.

CREATE TABLE app.professional_config (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  professional_id uuid NOT NULL REFERENCES app.professional(id),
  -- Identificacao extra
  especialidade         text,
  rp                    text,          -- Registro Profissional (CFO, CRF, etc.)
  cbo                   text,          -- CBO do profissional
  -- Preferencias de documento
  modelo_padrao         text DEFAULT 'atestado'
    CHECK (modelo_padrao IN ('atestado','declaracao_comparecimento','pedido_exame','relatorio')),
  usar_carimbo_digital  boolean DEFAULT false,
  -- Contato alternativo
  email_alternativo     text,
  telefone_alternativo  text,
  -- Preferencias de agenda
  duracao_padrao_min    integer DEFAULT 30,
  updated_at            timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, professional_id)
);
ALTER TABLE app.professional_config OWNER TO app_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.professional_config TO app_rw;

-- RLS: mesma politica de app.professional — acesso pelo tenant_id do contexto
ALTER TABLE app.professional_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.professional_config FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY professional_config_tenant ON app.professional_config
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY professional_config_professional ON app.professional_config
    FOR ALL USING (professional_id IN (
      SELECT id FROM app.professional
       WHERE tenant_id = current_setting('app.tenant_id')::uuid
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE app.professional_config IS
  'Configuracao por profissional: especialidade, RP, CBO, preferencias de documento e agenda.';
