-- 0166_clinic_print_config.sql
-- Configuracao de impressao por clinica: cabeçalho, rodape e opcoes de exibicao.

CREATE TABLE app.clinic_print_config (
  clinic_id          uuid PRIMARY KEY REFERENCES app.clinic(id),
  -- Cabecalho
  logo_url           text,
  header_line1       text,
  header_line2       text,
  header_line3       text,
  -- Rodape
  footer_legal       text,
  footer_disclaimer  text,
  -- Opcoes
  show_cnpj         boolean DEFAULT true,
  show_cnes         boolean DEFAULT true,
  show_professional boolean DEFAULT true,
  paper_size        text DEFAULT 'A4' CHECK (paper_size IN ('A4', 'CARD')),
  updated_at        timestamptz DEFAULT now()
);
ALTER TABLE app.clinic_print_config OWNER TO app_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.clinic_print_config TO app_rw;

-- RLS: mesma politica de app.clinic — acesso pela clinic_id do contexto
ALTER TABLE app.clinic_print_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY clinic_print_config_clinic ON app.clinic_print_config
    FOR ALL USING (clinic_id = current_setting('app.clinic_id')::uuid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE app.clinic_print_config IS
  'Configuracao de impressao (cabecalho, rodape, branding) por clinica.';
