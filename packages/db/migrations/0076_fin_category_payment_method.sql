-- 0076_fin_category_payment_method.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `fin` ja existe (migration 0002). Aqui nascem os tipos enumerados e as
-- tabelas de referencia: categorias de lancamento e metodos de pagamento.
-- Dinheiro em centavos inteiros (bigint), sem numeric — decisao irreversivel §10.

-- ---------------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------------
CREATE TYPE fin.entry_kind AS ENUM ('receita', 'despesa');

CREATE TYPE fin.payment_method_kind AS ENUM (
  'dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'link', 'convenio');

CREATE TYPE fin.entry_status AS ENUM (
  'pendente', 'pago', 'cancelado', 'estornado');

-- ---------------------------------------------------------------------------
-- 2. Categorias de lancamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.category (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  name        text NOT NULL COLLATE "pt-BR-x-icu",
  kind        fin.entry_kind NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name, kind)
);
ALTER TABLE fin.category OWNER TO app_owner;
ALTER TABLE fin.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.category FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.category AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Metodos de pagamento do tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.payment_method (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  kind         fin.payment_method_kind NOT NULL,
  name         text NOT NULL COLLATE "pt-BR-x-icu",
  provider_ref text,          -- ref do PSP para cartao/pix; null para dinheiro
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE fin.payment_method OWNER TO app_owner;
ALTER TABLE fin.payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_method FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_method AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
