-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Fornecedor e FK em fin.entry.supplier_id.
-- cpf_cnpj e varchar(14) alfanumerico (CNPJ novo desde 01/07/2026).

-- ---------------------------------------------------------------------------
-- 1. Tabela de fornecedores
-- ---------------------------------------------------------------------------
CREATE TABLE fin.supplier (
  tenant_id  uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id         uuid           NOT NULL,
  name       text           NOT NULL COLLATE "pt-BR-x-icu",
  cpf_cnpj   varchar(14),
  contact    text,
  active     boolean        NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE fin.supplier OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.supplier TO app_rw;

ALTER TABLE fin.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.supplier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.supplier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_supplier_active ON fin.supplier (tenant_id, active)
  WHERE active;

-- ---------------------------------------------------------------------------
-- 2. FK composta em fin.entry para fornecedor (nullable — retrocompativel)
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN supplier_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_supplier
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES fin.supplier(tenant_id, id);

CREATE INDEX ix_entry_supplier ON fin.entry (tenant_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs (BYPASSRLS ignora POLICY, nao ignora GRANT)
-- ---------------------------------------------------------------------------
GRANT SELECT ON fin.supplier TO jobs;
