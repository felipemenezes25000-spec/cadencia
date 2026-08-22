-- 0200_sus_public_foundation.sql
-- Camada publica/SUS sobre o nucleo clinico existente.
-- tenant/clinic permanecem como chaves tecnicas de isolamento; na interface
-- representam ente publico e unidade de saude.

ALTER TABLE app.tenant
  ADD COLUMN IF NOT EXISTS municipio_ibge char(7)
    CHECK (municipio_ibge IS NULL OR municipio_ibge ~ '^[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS uf char(2)
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS tipo_ente text NOT NULL DEFAULT 'municipio'
    CHECK (tipo_ente IN ('municipio','consorcio','estado','distrito_federal','outro'));

ALTER TABLE app.clinic
  ADD COLUMN IF NOT EXISTS municipio_ibge char(7)
    CHECK (municipio_ibge IS NULL OR municipio_ibge ~ '^[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS tipo_estabelecimento text,
  ADD COLUMN IF NOT EXISTS codigo_unidade_local text;

CREATE TYPE app.public_role AS ENUM (
  'gestor_municipal','gestor_unidade','regulacao','acs','enfermagem','medico','dentista','auditor'
);

CREATE TABLE app.public_membership_profile (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES id."user"(id),
  public_role app.public_role NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, user_id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
ALTER TABLE app.public_membership_profile OWNER TO app_owner;

CREATE TABLE app.sus_team (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ine char(10) CHECK (ine IS NULL OR ine ~ '^[0-9]{10}$'),
  nome text NOT NULL,
  tipo text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
CREATE UNIQUE INDEX ux_sus_team_ine ON app.sus_team(tenant_id, ine) WHERE ine IS NOT NULL;
ALTER TABLE app.sus_team OWNER TO app_owner;

CREATE TABLE app.professional_sus_link (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  cns char(15) NOT NULL CHECK (cns ~ '^[0-9]{15}$'),
  cbo varchar(6) NOT NULL CHECK (cbo ~ '^[0-9]{4,6}$'),
  team_id uuid,
  carga_horaria_semanal smallint CHECK (
    carga_horaria_semanal IS NULL OR carga_horaria_semanal BETWEEN 1 AND 80),
  ativo boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  PRIMARY KEY (tenant_id, clinic_id, professional_id, cbo),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id, team_id) REFERENCES app.sus_team(tenant_id, clinic_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_professional_sus_cns ON app.professional_sus_link(tenant_id, cns);
ALTER TABLE app.professional_sus_link OWNER TO app_owner;

CREATE TABLE clin.patient_sus_profile (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  patient_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  team_id uuid,
  microarea varchar(4),
  territorio text,
  prontuario_familia text,
  vulnerabilidade text CHECK (
    vulnerabilidade IS NULL OR vulnerabilidade IN ('baixa','media','alta','muito_alta')),
  acamado boolean NOT NULL DEFAULT false,
  domiciliado boolean NOT NULL DEFAULT false,
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, patient_id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id, team_id) REFERENCES app.sus_team(tenant_id, clinic_id, id)
);
ALTER TABLE clin.patient_sus_profile OWNER TO app_owner;

CREATE TABLE app.referral (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  origin_clinic_id uuid NOT NULL,
  destination_clinic_id uuid,
  requested_by_user_id uuid NOT NULL REFERENCES id."user"(id),
  especialidade text NOT NULL,
  sigtap_code varchar(10),
  prioridade text NOT NULL DEFAULT 'normal'
    CHECK (prioridade IN ('normal','prioritaria','urgente')),
  status text NOT NULL DEFAULT 'solicitado'
    CHECK (status IN ('solicitado','em_regulacao','agendado','atendido','devolvido','cancelado')),
  motivo text NOT NULL,
  resumo_clinico text,
  regulacao_observacao text,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, origin_clinic_id) REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_clinic_id) REFERENCES app.clinic(tenant_id, id)
);
CREATE INDEX ix_referral_queue ON app.referral(tenant_id, status, prioridade, created_at);
CREATE INDEX ix_referral_patient ON app.referral(tenant_id, patient_id, created_at DESC);
ALTER TABLE app.referral OWNER TO app_owner;

CREATE TABLE ref.ciap2_term (
  codigo varchar(8) NOT NULL,
  descricao text NOT NULL,
  capitulo varchar(4),
  competencia text NOT NULL,
  vigencia daterange NOT NULL,
  PRIMARY KEY (codigo, competencia)
);
ALTER TABLE ref.ciap2_term OWNER TO app_owner;
CREATE INDEX ix_ciap2_busca ON ref.ciap2_term USING gin (to_tsvector('portuguese', descricao));

CREATE TABLE ref.sigtap_procedure (
  codigo varchar(10) NOT NULL CHECK (codigo ~ '^[0-9]{10}$'),
  descricao text NOT NULL,
  grupo varchar(2),
  subgrupo varchar(4),
  forma_organizacao varchar(6),
  competencia text NOT NULL,
  vigencia daterange NOT NULL,
  PRIMARY KEY (codigo, competencia)
);
ALTER TABLE ref.sigtap_procedure OWNER TO app_owner;
CREATE INDEX ix_sigtap_busca ON ref.sigtap_procedure USING gin (to_tsvector('portuguese', descricao));

GRANT SELECT, INSERT, UPDATE ON app.public_membership_profile TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.sus_team TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.professional_sus_link TO app_rw;
GRANT SELECT, INSERT, UPDATE ON clin.patient_sus_profile TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.referral TO app_rw;
GRANT SELECT ON ref.ciap2_term, ref.sigtap_procedure TO app_rw;

ALTER TABLE app.public_membership_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.public_membership_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.public_membership_profile AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.sus_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sus_team FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.sus_team AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.professional_sus_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.professional_sus_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.professional_sus_link AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE clin.patient_sus_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient_sus_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.patient_sus_profile AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.referral FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.referral AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
