-- 0124_tiss_demonstrativo_item.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Item do demonstrativo TISS: resultado financeiro de cada guia individual
-- dentro de um demonstrativo de retorno. Liga ao encounter_guia_consulta via
-- FK composta. O numero_guia_prestador e gravado para facilitar o match mesmo
-- quando a guia nao e encontrada no sistema (reconciliacao manual).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

CREATE TABLE tiss.demonstrativo_item (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  demonstrativo_id        uuid NOT NULL,
  guia_id                 uuid,
  numero_guia_prestador   varchar(20) NOT NULL,
  valor_apresentado_cents bigint NOT NULL CHECK (valor_apresentado_cents >= 0),
  valor_processado_cents  bigint NOT NULL CHECK (valor_processado_cents >= 0),
  valor_liberado_cents    bigint NOT NULL CHECK (valor_liberado_cents >= 0),
  valor_glosa_cents       bigint NOT NULL CHECK (valor_glosa_cents >= 0),
  glosa_codigo            varchar(4),
  glosa_descricao         text,

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, demonstrativo_id)
    REFERENCES tiss.demonstrativo(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id),

  -- glosa_codigo e glosa_descricao vivem ou morrem juntos
  CHECK (num_nonnulls(glosa_codigo, glosa_descricao) IN (0, 2))
);
ALTER TABLE tiss.demonstrativo_item OWNER TO app_owner;
GRANT SELECT, INSERT ON tiss.demonstrativo_item TO app_rw;
GRANT SELECT, INSERT ON tiss.demonstrativo_item TO jobs;

-- Indices
CREATE INDEX ix_demonstrativo_item_demo
  ON tiss.demonstrativo_item (tenant_id, demonstrativo_id);

CREATE INDEX ix_demonstrativo_item_guia
  ON tiss.demonstrativo_item (tenant_id, guia_id)
  WHERE guia_id IS NOT NULL;

-- RLS
ALTER TABLE tiss.demonstrativo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.demonstrativo_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.demonstrativo_item
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_bypass ON tiss.demonstrativo_item
  AS PERMISSIVE FOR ALL TO jobs
  USING (true) WITH CHECK (true);
