-- 0082_fin_webhook_event.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 2 · Bloco 07 — Tabela para gravar eventos brutos recebidos do PSP
-- (Payment Service Provider). Referencia: 00-CONTRATOS.md item A7.

-- ---------------------------------------------------------------------------
-- 1. GRANTs do schema fin para o papel jobs
--    O webhook de pagamento usa jobsPool (BYPASSRLS) para resolver o
--    payment_link / entry antes de conhecer o tenant. BYPASSRLS ignora
--    POLICY, nao ignora GRANT.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA fin TO jobs;
GRANT SELECT ON fin.payment_link TO jobs;
GRANT SELECT ON fin.entry TO jobs;

-- ---------------------------------------------------------------------------
-- 2. Tabela de eventos brutos do webhook do PSP
-- ---------------------------------------------------------------------------
CREATE TABLE fin.webhook_event (
  tenant_id   uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id          uuid           NOT NULL,
  event_type  text           NOT NULL,
  raw_payload jsonb          NOT NULL,
  received_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
ALTER TABLE fin.webhook_event OWNER TO app_owner;
GRANT SELECT, INSERT ON fin.webhook_event TO app_rw;
GRANT SELECT ON fin.webhook_event TO jobs;

ALTER TABLE fin.webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.webhook_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.webhook_event AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_webhook_event_type ON fin.webhook_event
  (tenant_id, event_type, received_at DESC);
