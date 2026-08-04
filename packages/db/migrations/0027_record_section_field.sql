-- 0027_record_section_field.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 e §4.2 — a definicao de campo e APPEND-ONLY e VERSIONADA por generation.
-- Mudar TIPO ou OPCOES arquiva e cria generation + 1. Mudar so o ROTULO e
-- permitido, porque encounter_field_value.label_snapshot ja protegeu o passado.

CREATE TYPE clin.field_kind AS ENUM (
  'texto_longo','texto_curto','numerico','composto','booleano','data',
  'lista_unica','multipla_escolha','busca_tabela','imc','dpp_ig',
  'curva_crescimento','odontograma','oculos','orcamento');

CREATE TABLE clin.record_section (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  -- De qual template e de qual VERSAO esta secao veio. NULL = criada a mao.
  template_id      uuid REFERENCES ref.record_template(id),
  template_version int,
  code             text NOT NULL,
  label            text NOT NULL,
  ordinal          int  NOT NULL,
  archived_at      timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  CHECK ((template_id IS NULL) = (template_version IS NULL)));
ALTER TABLE clin.record_section OWNER TO app_owner;

CREATE UNIQUE INDEX ux_record_section_viva
  ON clin.record_section (tenant_id, code) WHERE archived_at IS NULL;

CREATE TABLE clin.record_field (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  section_id       uuid NOT NULL,
  code             text NOT NULL,
  label            text NOT NULL,
  kind             clin.field_kind NOT NULL,
  -- generation sobe quando TIPO ou OPCOES mudam. O valor gravado carrega
  -- field_generation, e por isso o passado continua legivel.
  generation       int  NOT NULL DEFAULT 1 CHECK (generation >= 1),
  required         boolean NOT NULL DEFAULT false,
  is_reportable    boolean NOT NULL DEFAULT false,
  -- Numerico promovido para clin.observation precisa de codigo do catalogo.
  observation_code text REFERENCES ref.observation_code(code),
  unit             text,
  -- lista_unica e multipla_escolha: as opcoes. Mudar aqui exige nova generation.
  options          jsonb,
  -- busca_tabela: 'CID10' ou 'TUSS'.
  ref_source       text CHECK (ref_source IN ('CID10','TUSS')),
  ordinal          int  NOT NULL,
  archived_at      timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, section_id) REFERENCES clin.record_section(tenant_id, id),
  -- Um campo que promove para observation precisa saber PARA QUAL codigo.
  CHECK (NOT is_reportable OR kind = 'composto' OR observation_code IS NOT NULL),
  CHECK (kind <> 'busca_tabela' OR ref_source IS NOT NULL),
  CHECK (kind NOT IN ('lista_unica','multipla_escolha') OR options IS NOT NULL));
ALTER TABLE clin.record_field OWNER TO app_owner;

-- A unicidade e PARCIAL. Com unicidade total, mudar "Peso" de texto para
-- numerico falha com 23505 e o medico ve "erro ao salvar configuracao".
CREATE UNIQUE INDEX ux_record_field_viva
  ON clin.record_field (tenant_id, section_id, code) WHERE archived_at IS NULL;
CREATE INDEX ix_record_field_secao
  ON clin.record_field (tenant_id, section_id, ordinal) WHERE archived_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.record_section TO app_rw;
GRANT SELECT, INSERT, UPDATE ON clin.record_field   TO app_rw;
-- DELETE nunca: definicao arquivada continua sendo lida por valores antigos.

ALTER TABLE clin.record_section ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_section FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_section AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE clin.record_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_field FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_field AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
