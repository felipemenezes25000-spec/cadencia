-- 0035_first_class_clinical.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — um dominio SAI do EAV quando: (a) e eixo de filtro/agregacao de
-- relatorio que entregamos; (b) e referenciado por norma externa; (c) tem regra
-- regulatoria propria; (d) tem ciclo de vida proprio no atendimento.
--
-- occurred_date e patient_id sao DESNORMALIZADOS nas filhas: e o que faz o
-- relatorio ser um index scan em vez de tres joins.
--
-- `live` e BIT DE INDICE, nao registro clinico: false quando a versao e superada.
-- Fica FORA da serializacao canonica (invariante testado na Task 18). A linha
-- nunca some da auditoria nem da exportacao integral.

-- ---------------------------------------------------------------------------
-- Diagnostico (CID)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.diagnosis (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  code_system text NOT NULL CHECK (code_system IN ('CID10','CID11')),
  code text NOT NULL,
  display_snapshot text NOT NULL,
  terminology_version text NOT NULL,
  is_principal boolean NOT NULL DEFAULT false,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id));
ALTER TABLE clin.diagnosis OWNER TO app_owner;

CREATE INDEX ix_diag_report ON clin.diagnosis
  (tenant_id, code_system, code, occurred_date DESC)
  INCLUDE (patient_id, professional_id, encounter_id, is_principal) WHERE live;
CREATE INDEX ix_diag_version ON clin.diagnosis (tenant_id, version_id);
CREATE INDEX ix_diag_paciente ON clin.diagnosis (tenant_id, patient_id, occurred_date DESC)
  WHERE live;

-- ---------------------------------------------------------------------------
-- Observacao (numericos promovidos, inclusive componentes de campo composto)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.observation (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  observation_code text NOT NULL REFERENCES ref.observation_code(code),
  value_num numeric NOT NULL,
  unit text,
  -- Campo composto: PA gera PA_SIS (component_ordinal 1) e PA_DIA (2).
  field_id uuid NOT NULL, component_ordinal int NOT NULL DEFAULT 0,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, field_id)     REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.observation OWNER TO app_owner;

-- Serie do paciente: e o que desenha o grafico de peso e de pressao.
CREATE INDEX ix_obs_serie ON clin.observation
  (tenant_id, patient_id, observation_code, occurred_date DESC)
  INCLUDE (value_num, unit) WHERE live;
CREATE INDEX ix_obs_version ON clin.observation (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Achado categorico (lista_unica e multipla_escolha promovidos)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.encounter_finding (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  field_id uuid NOT NULL, field_code text NOT NULL,
  option_code text NOT NULL, display_snapshot text NOT NULL,
  ordinal int NOT NULL DEFAULT 0,
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, field_id)     REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.encounter_finding OWNER TO app_owner;

-- "Liste os diabeticos": este indice e a razao de multipla_escolha virar N linhas.
CREATE INDEX ix_finding_report ON clin.encounter_finding
  (tenant_id, field_code, option_code, occurred_date DESC)
  INCLUDE (patient_id) WHERE live;
CREATE INDEX ix_finding_version ON clin.encounter_finding (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Procedimento (TUSS)
-- ---------------------------------------------------------------------------
CREATE TABLE clin.procedure (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, encounter_id uuid NOT NULL, version_id uuid NOT NULL,
  patient_id uuid NOT NULL, professional_id uuid NOT NULL, clinic_id uuid NOT NULL,
  occurred_date date NOT NULL,
  code_system text NOT NULL CHECK (code_system IN ('TUSS','PROPRIO')),
  tabela smallint, code text NOT NULL,
  display_snapshot text NOT NULL, terminology_version text,
  quantidade int NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  -- Dinheiro em CENTAVOS inteiros, nunca float (§2.3).
  valor_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  live boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, version_id)   REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  CHECK ((code_system = 'TUSS') = (tabela IS NOT NULL)));
ALTER TABLE clin.procedure OWNER TO app_owner;

CREATE INDEX ix_proc_report ON clin.procedure
  (tenant_id, code_system, code, occurred_date DESC)
  INCLUDE (patient_id, valor_centavos) WHERE live;
CREATE INDEX ix_proc_version ON clin.procedure (tenant_id, version_id);

-- ---------------------------------------------------------------------------
-- Privilegios, trigger e RLS — identicos nas quatro. `live` e a UNICA coluna
-- atualizavel, e so por clin_writer dentro de clin.amend_encounter.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnosis','observation','encounter_finding','procedure'] LOOP
    EXECUTE format('REVOKE ALL ON clin.%I FROM PUBLIC, app_rw', t);
    EXECUTE format('GRANT SELECT ON clin.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT ON clin.%I TO clin_writer', t);
    EXECUTE format('GRANT UPDATE (live) ON clin.%I TO clin_writer', t);

    -- deny_mutation com excecao para o bit live: o trigger e BEFORE UPDATE OF,
    -- listando todas as colunas MENOS live. Assim UPDATE (live) passa e
    -- qualquer outro UPDATE morre, para qualquer papel, inclusive o dono.
    EXECUTE format($f$
      CREATE TRIGGER no_mutate BEFORE DELETE ON clin.%I
        FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation()$f$, t);

    EXECUTE format('ALTER TABLE clin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE clin.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON clin.%I AS PERMISSIVE FOR ALL TO app_rw
        USING (tenant_id = app.current_tenant_id() AND app.is_member())$p$, t);
    EXECUTE format($p$
      CREATE POLICY writer ON clin.%I AS PERMISSIVE FOR ALL TO clin_writer
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.require_tenant_id())$p$, t);
    EXECUTE format($p$
      CREATE POLICY clinical_scope ON clin.%I AS RESTRICTIVE FOR SELECT TO app_rw
        USING ( app.clinical_scope_all()
                OR professional_id = app.current_professional_id()
                OR EXISTS (SELECT 1 FROM clin.record_share s
                            WHERE (s.tenant_id, s.patient_id) = (clin.%I.tenant_id, clin.%I.patient_id)
                              AND s.grantee_professional_id = app.current_professional_id()
                              AND s.revoked_at IS NULL) )$p$, t, t, t);
  END LOOP;
END $$;

-- Trigger separado para UPDATE, listando as colunas proibidas explicitamente:
-- UPDATE OF <colunas> so dispara quando uma delas aparece no SET.
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, code_system, code, display_snapshot, terminology_version, is_principal
  ON clin.diagnosis FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, observation_code, value_num, unit, field_id, component_ordinal
  ON clin.observation FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, field_id, field_code, option_code, display_snapshot, ordinal
  ON clin.encounter_finding FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
  occurred_date, code_system, tabela, code, display_snapshot, terminology_version,
  quantidade, valor_centavos
  ON clin.procedure FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
