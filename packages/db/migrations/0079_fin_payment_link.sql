-- 0079_fin_payment_link.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Link de pagamento e log de conciliacao.
-- Premissa: fin.entry e fin.entry_kind ja existem (migration anterior).

BEGIN;

--------------------------------------------------------------------
-- 1. fin.payment_link — vincula um link do PSP a um lancamento
--------------------------------------------------------------------
CREATE TABLE fin.payment_link (
  tenant_id       uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid           NOT NULL,
  entry_id        uuid           NOT NULL,
  provider_link_id varchar(120)  NOT NULL,
  url             text           NOT NULL,
  status          text           NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','expired','cancelled')),
  amount_cents    bigint         NOT NULL CHECK (amount_cents > 0),
  paid_at         timestamptz(3),
  fee_cents       bigint,
  method          text,
  provider_id     text           NOT NULL,
  idempotency_key text           NOT NULL,
  webhook_raw     jsonb,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by      uuid           NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider_link_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.payment_link OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.payment_link TO app_rw;

ALTER TABLE fin.payment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_link FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.payment_link AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_payment_link_entry ON fin.payment_link (tenant_id, entry_id);
CREATE INDEX ix_payment_link_status ON fin.payment_link (tenant_id, status)
  WHERE status = 'pending';

--------------------------------------------------------------------
-- 2. fin.reconciliation_log — divergencias detectadas pela conciliacao
--------------------------------------------------------------------
CREATE TABLE fin.reconciliation_log (
  tenant_id          uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid           NOT NULL,
  reconciled_date    date           NOT NULL,
  provider_payment_id varchar(120)  NOT NULL,
  entry_id           uuid,
  kind               text           NOT NULL
                       CHECK (kind IN (
                         'amount_mismatch', 'fee_mismatch',
                         'missing_in_psp', 'missing_in_system',
                         'status_mismatch'
                       )),
  expected_cents     bigint,
  actual_cents       bigint,
  detail             text,
  resolved           boolean        NOT NULL DEFAULT false,
  resolved_at        timestamptz(3),
  resolved_by        uuid,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
ALTER TABLE fin.reconciliation_log OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.reconciliation_log TO app_rw;

ALTER TABLE fin.reconciliation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.reconciliation_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.reconciliation_log AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_reconciliation_date ON fin.reconciliation_log (tenant_id, reconciled_date);
CREATE INDEX ix_reconciliation_unresolved ON fin.reconciliation_log (tenant_id)
  WHERE resolved = false;

COMMIT;
