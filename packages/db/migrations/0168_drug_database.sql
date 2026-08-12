-- 0168_drug_database.sql
-- Bulário ANVISA - schema para medicamentos e bulas
-- Forward-only: não existe down migration.

CREATE SCHEMA IF NOT EXISTS drug;

CREATE TABLE drug.medicamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_anvisa text UNIQUE NOT NULL,
  nome text NOT NULL,
  principio_ativo text NOT NULL,
  classe_terapeutica text,
  concentracao text,
  forma_farmaceutica text,
  fabricante text,
  created_at timestamptz DEFAULT clock_timestamp()
);

CREATE TABLE drug.bula (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicamento_id uuid NOT NULL REFERENCES drug.medicamento(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('paciente', 'profissional')),
  conteudo text NOT NULL,
  versao text,
  data_publicacao date,
  created_at timestamptz DEFAULT clock_timestamp()
);

ALTER TABLE drug.medicamento OWNER TO app_owner;
ALTER TABLE drug.bula OWNER TO app_owner;

-- Índices para busca textual em português
CREATE INDEX idx_medicamento_nome ON drug.medicamento USING gin(to_tsvector('portuguese', nome));
CREATE INDEX idx_medicamento_principio ON drug.medicamento(principio_ativo);
CREATE INDEX idx_medicamento_registro ON drug.medicamento(registro_anvisa);
CREATE INDEX idx_bula_medicamento ON drug.bula(medicamento_id);
CREATE INDEX idx_bula_tipo ON drug.bula(tipo);

-- Permissões
GRANT USAGE ON SCHEMA drug TO app_reader, app_rw;
GRANT SELECT ON drug.medicamento TO app_reader, app_rw;
GRANT SELECT ON drug.bula TO app_reader, app_rw;
