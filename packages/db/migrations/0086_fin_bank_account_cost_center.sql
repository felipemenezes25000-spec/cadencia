-- 0086_fin_bank_account_cost_center.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.10 / Fase 3 bloco 01: contas bancarias e centros de custo.
-- Conta bancaria identifica onde o dinheiro da clinica transita. A sentinela
-- "Caixa Geral" existe em todo tenant novo e nao pode ser desativada.
-- Centro de custo e dimensao opcional de classificacao de lancamento.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado para tipo de conta bancaria
-- ---------------------------------------------------------------------------
CREATE TYPE fin.bank_account_type AS ENUM ('corrente', 'poupanca');

-- ---------------------------------------------------------------------------
-- 2. Conta bancaria
-- ---------------------------------------------------------------------------
CREATE TABLE fin.bank_account (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  name               text NOT NULL COLLATE "pt-BR-x-icu",
  bank_code          text,                -- codigo COMPE/ISPB; NULL para caixa geral
  agency             text,                -- agencia; NULL para caixa geral
  account_number     text,                -- numero da conta; NULL para caixa geral
  account_type       fin.bank_account_type,  -- NULL para caixa geral
  initial_balance_cents bigint NOT NULL DEFAULT 0,
  is_default         boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

ALTER TABLE fin.bank_account OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.bank_account TO app_rw;

ALTER TABLE fin.bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.bank_account FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.bank_account AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- Indice parcial: no maximo UMA conta default por tenant
CREATE UNIQUE INDEX ux_bank_account_default
  ON fin.bank_account (tenant_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- 3. Centro de custo
-- ---------------------------------------------------------------------------
CREATE TABLE fin.cost_center (
  tenant_id   uuid NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL COLLATE "pt-BR-x-icu",
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

ALTER TABLE fin.cost_center OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.cost_center TO app_rw;

ALTER TABLE fin.cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cost_center FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.cost_center AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

COMMIT;
