-- 0116_tiss_guia_ajuste.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — ajuste de faturamento da guia de consulta. Append-only: a guia
-- original nao e sobrescrita; o ajuste carrega campo alterado, valor anterior,
-- valor novo, motivo e autor. Sem now()/current_date (invariante tiss).

CREATE TABLE tiss.guia_ajuste (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  guia_id         uuid NOT NULL,
  campo_alterado  text NOT NULL,
  valor_anterior  text NOT NULL,
  valor_novo      text NOT NULL,
  motivo          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id)
);

ALTER TABLE tiss.guia_ajuste OWNER TO app_owner;

-- Indice para listar ajustes de uma guia.
CREATE INDEX ix_guia_ajuste_guia
  ON tiss.guia_ajuste (tenant_id, guia_id, created_at);

-- RLS
ALTER TABLE tiss.guia_ajuste ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.guia_ajuste FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.guia_ajuste
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs: append-only — INSERT e SELECT, sem UPDATE nem DELETE.
GRANT SELECT, INSERT ON tiss.guia_ajuste TO app_rw;
GRANT SELECT ON tiss.guia_ajuste TO rpt_owner;
