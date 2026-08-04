-- 0006_patient.sql
-- Fase 0 · design §3.3 e decisao irreversivel §10 item 9.

-- unaccent(text) e apenas STABLE; coluna GENERATED exige IMMUTABLE.
-- Fixar o dicionario torna a funcao imutavel de verdade.
CREATE FUNCTION app.imm_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
ALTER FUNCTION app.imm_unaccent(text) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.imm_unaccent(text) TO app_rw;

CREATE TABLE clin.patient (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL,
  full_name text NOT NULL,
  nome_social text,                       -- Decreto 8.727/2016: usado em TODA exibicao
  identidade_genero text,                 -- separado de sexo ao nascer
  birth_date date,                        -- NULLABLE: ver cadastro preliminar
  sex_at_birth char(1) CHECK (sex_at_birth IN ('M','F','I')),
  phone_primary varchar(20), email citext,
  cadastro_status text NOT NULL DEFAULT 'preliminar'
    CHECK (cadastro_status IN ('preliminar','completo')),
  deceased_at date, inactivated_at timestamptz(3),
  ai_refused_at timestamptz(3),           -- CFM 2.454/2026, no nivel do titular
  merged_into_id uuid,                    -- unificacao: aponta para o sobrevivente
  search_name text GENERATED ALWAYS AS (app.imm_unaccent(lower(
      coalesce(nome_social, full_name)))) STORED,
  search_digits text,                     -- so digitos: CPF, telefone (normalizado na app)
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES clin.patient(tenant_id, id));
ALTER TABLE clin.patient OWNER TO app_owner;

-- CPF e UM identificador entre varios, nao O identificador.
CREATE TABLE clin.patient_identifier (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, patient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CPF','CNS','DNV','PASSAPORTE','RG','CARTEIRINHA','SEM_DOCUMENTO')),
  value text NOT NULL, issuer text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id,id));
ALTER TABLE clin.patient_identifier OWNER TO app_owner;

CREATE UNIQUE INDEX ux_pid ON clin.patient_identifier (tenant_id, kind, value)
  WHERE kind <> 'SEM_DOCUMENTO';
CREATE INDEX ix_patient_busca ON clin.patient USING gin (tenant_id, search_name gin_trgm_ops);
CREATE INDEX ix_patient_digits ON clin.patient (tenant_id, search_digits varchar_pattern_ops);
CREATE INDEX ix_patient_identifier_paciente
  ON clin.patient_identifier (tenant_id, patient_id);
