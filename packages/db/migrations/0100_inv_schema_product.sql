-- 0100_inv_schema_product.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `inv` nasce aqui, com o mesmo dono e padrao de GRANT dos demais.
-- Fornecedor (inv.supplier) e produto (inv.product) sao as entidades base
-- do estoque. current_stock e DERIVADO: o trigger da Task 27 (migration 0099)
-- o mantem sincronizado com inv.stock_movement.

-- ---------------------------------------------------------------------------
-- 0. Schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA inv AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA inv TO app_rw, clin_writer, app_support;

-- ---------------------------------------------------------------------------
-- 1. Unidade de medida (enum)
-- ---------------------------------------------------------------------------
CREATE TYPE inv.unit_kind AS ENUM ('un', 'cx', 'ml', 'g', 'kg');

-- ---------------------------------------------------------------------------
-- 2. Fornecedor
-- ---------------------------------------------------------------------------
CREATE TABLE inv.supplier (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  name         text NOT NULL COLLATE "pt-BR-x-icu",
  cnpj         text,
  phone        text,
  email        text,
  notes        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE inv.supplier OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.supplier TO app_rw;
ALTER TABLE inv.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.supplier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.supplier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Produto
-- ---------------------------------------------------------------------------
CREATE TABLE inv.product (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  id               uuid NOT NULL,
  name             text NOT NULL COLLATE "pt-BR-x-icu",
  sku              text COLLATE "pt-BR-x-icu",
  unit             inv.unit_kind NOT NULL DEFAULT 'un',
  min_stock        numeric NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  current_stock    numeric NOT NULL DEFAULT 0,
  cost_price_cents bigint NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
  sale_price_cents bigint NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  supplier_id      uuid,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES inv.supplier(tenant_id, id)
);
ALTER TABLE inv.product OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.product TO app_rw;

-- SKU unico parcial: so entre ativos, e so quando preenchido
CREATE UNIQUE INDEX ux_product_sku_active
  ON inv.product (tenant_id, sku) WHERE active AND sku IS NOT NULL;

CREATE INDEX ix_product_name
  ON inv.product (tenant_id, name COLLATE "pt-BR-x-icu") WHERE active;

ALTER TABLE inv.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.product FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.product AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
