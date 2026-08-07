-- 0111_tiss_contrato.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 Fase 4: contrato do prestador com uma operadora.
-- Cada contrato representa o vinculo de uma clinica com uma operadora: o codigo
-- do prestador na operadora, o tipo de acomodacao, abrangencia, vigencia e
-- referencia de tabela de precos acordada (que pode divergir da TUSS publica).
-- Nenhuma ocorrencia de now() ou current_date no schema tiss — invariante de CI.

CREATE TABLE tiss.contrato (
  tenant_id                     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                            uuid NOT NULL,
  operadora_id                  uuid NOT NULL,
  clinic_id                     uuid NOT NULL,
  codigo_prestador_na_operadora varchar(14) NOT NULL,
  tipo_acomodacao               char(1) NOT NULL DEFAULT '1'
    CHECK (tipo_acomodacao IN ('1','2','3')),
  abrangencia                   text NOT NULL DEFAULT 'nacional'
    CHECK (abrangencia IN ('nacional','estadual','grupo_estadual','municipal')),
  vigencia_inicio               date NOT NULL,
  vigencia_fim                  date,
  tabela_precos_ref             text,
  observacao                    text,
  active                        boolean NOT NULL DEFAULT true,
  created_at                    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by                    uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, clinic_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id) REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
ALTER TABLE tiss.contrato OWNER TO app_owner;

CREATE INDEX ix_contrato_operadora
  ON tiss.contrato (tenant_id, operadora_id) WHERE active;

CREATE INDEX ix_contrato_clinic
  ON tiss.contrato (tenant_id, clinic_id) WHERE active;

GRANT SELECT, INSERT, UPDATE ON tiss.contrato TO app_rw;
GRANT SELECT ON tiss.contrato TO jobs;

ALTER TABLE tiss.contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.contrato FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.contrato AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_read ON tiss.contrato AS PERMISSIVE FOR SELECT TO jobs
  USING (true);
