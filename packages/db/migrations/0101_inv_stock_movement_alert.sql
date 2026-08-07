-- 0101_inv_stock_movement_alert.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Movimentacao de estoque e alerta de estoque minimo. O current_stock de
-- inv.product e DERIVADO: um trigger AFTER INSERT em stock_movement recalcula
-- a soma real (entrada - saida - perda + ajuste). A soma e conferida, nao confiada.

-- ---------------------------------------------------------------------------
-- 1. Tipo de movimentacao
-- ---------------------------------------------------------------------------
CREATE TYPE inv.movement_kind AS ENUM ('entrada', 'saida', 'ajuste', 'perda');

-- ---------------------------------------------------------------------------
-- 2. Tipo de referencia da movimentacao
-- ---------------------------------------------------------------------------
CREATE TYPE inv.reference_type AS ENUM (
  'compra', 'uso_atendimento', 'ajuste_manual', 'perda');

-- ---------------------------------------------------------------------------
-- 3. Movimentacao de estoque
-- ---------------------------------------------------------------------------
CREATE TABLE inv.stock_movement (
  tenant_id      uuid NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid NOT NULL,
  product_id     uuid NOT NULL,
  kind           inv.movement_kind NOT NULL,
  quantity       numeric NOT NULL CHECK (quantity > 0),
  reason         text NOT NULL,
  reference_type inv.reference_type NOT NULL,
  reference_id   uuid,
  moved_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  moved_by       uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES inv.product(tenant_id, id)
);
ALTER TABLE inv.stock_movement OWNER TO app_owner;
GRANT SELECT, INSERT ON inv.stock_movement TO app_rw;

CREATE INDEX ix_movement_product
  ON inv.stock_movement (tenant_id, product_id, moved_at DESC);

ALTER TABLE inv.stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_movement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.stock_movement AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Trigger: atualiza current_stock de inv.product apos INSERT
--    A soma e CONFERIDA (SELECT SUM), nao confiada (incremento otimista).
-- ---------------------------------------------------------------------------
CREATE FUNCTION inv.fn_update_current_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric;
BEGIN
  SELECT COALESCE(SUM(
    CASE m.kind
      WHEN 'entrada' THEN m.quantity
      WHEN 'ajuste'  THEN m.quantity
      WHEN 'saida'   THEN -m.quantity
      WHEN 'perda'   THEN -m.quantity
    END
  ), 0)
  INTO v_new_stock
  FROM inv.stock_movement m
  WHERE m.tenant_id = NEW.tenant_id AND m.product_id = NEW.product_id;

  UPDATE inv.product
     SET current_stock = v_new_stock
   WHERE tenant_id = NEW.tenant_id AND id = NEW.product_id;

  RETURN NEW;
END;
$$;
ALTER FUNCTION inv.fn_update_current_stock() OWNER TO app_owner;

CREATE TRIGGER trg_update_current_stock
  AFTER INSERT ON inv.stock_movement
  FOR EACH ROW
  EXECUTE FUNCTION inv.fn_update_current_stock();

-- ---------------------------------------------------------------------------
-- 5. Alerta de estoque minimo
-- ---------------------------------------------------------------------------
CREATE TABLE inv.stock_alert (
  tenant_id    uuid NOT NULL DEFAULT app.require_tenant_id(),
  id           uuid NOT NULL,
  product_id   uuid NOT NULL,
  threshold    numeric NOT NULL CHECK (threshold >= 0),
  triggered_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  resolved_at  timestamptz(3),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES inv.product(tenant_id, id)
);
ALTER TABLE inv.stock_alert OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON inv.stock_alert TO app_rw;

CREATE INDEX ix_alert_open
  ON inv.stock_alert (tenant_id, product_id)
  WHERE resolved_at IS NULL;

ALTER TABLE inv.stock_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_alert FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv.stock_alert AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 6. GRANTs para jobs (alerta diario)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA inv TO jobs;
GRANT SELECT, INSERT, UPDATE ON inv.product TO jobs;
GRANT SELECT ON inv.stock_movement TO jobs;
GRANT SELECT, INSERT, UPDATE ON inv.stock_alert TO jobs;
GRANT SELECT ON inv.supplier TO jobs;
