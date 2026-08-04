-- 0028_record_field_component.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — 'PA' e um campo COMPOSTO que produz DUAS observacoes (PA_SIS, PA_DIA).
-- Existe desde o dia 1: promover so campos com um unico value_num exclui o sinal
-- vital mais medido do pais e obriga a gravar '120/80' como texto.

CREATE TABLE clin.record_field_component (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  field_id         uuid NOT NULL,
  ordinal          int  NOT NULL CHECK (ordinal >= 1),
  observation_code text NOT NULL REFERENCES ref.observation_code(code),
  label            text NOT NULL,
  unit             text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, field_id, ordinal),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, field_id) REFERENCES clin.record_field(tenant_id, id));
ALTER TABLE clin.record_field_component OWNER TO app_owner;

CREATE INDEX ix_field_component_campo
  ON clin.record_field_component (tenant_id, field_id, ordinal);

GRANT SELECT, INSERT, UPDATE ON clin.record_field_component TO app_rw;

ALTER TABLE clin.record_field_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_field_component FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.record_field_component
AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
