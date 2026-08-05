-- 0068_outbox.sql
-- Fase 2 · design §7.1 — outbox transacional.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- A tabela app.outbox recebe INSERT dentro da transacao de dominio (via
-- app.enqueue_outbox), garantindo que o evento so existe se o efeito de negocio
-- existir. O despachante no worker le, processa e marca dispatched_at.

CREATE TABLE app.outbox (
  tenant_id     uuid        NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_type    text        NOT NULL,
  aggregate_id  uuid        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz(3),
  attempts      smallint    NOT NULL DEFAULT 0,
  last_error    text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id));
ALTER TABLE app.outbox OWNER TO app_owner;

-- Indice de despacho: o worker busca eventos nao despachados com ate 5 tentativas,
-- ordenados por criacao. O filtro parcial mantem o indice pequeno.
CREATE INDEX ix_outbox_pending
  ON app.outbox (tenant_id, created_at)
  WHERE dispatched_at IS NULL AND attempts < 5;

-- Indice de dead-letter: eventos que esgotaram tentativas.
CREATE INDEX ix_outbox_dead_letter
  ON app.outbox (tenant_id, created_at)
  WHERE dispatched_at IS NULL AND attempts >= 5;

-- GRANTs: app_rw pode INSERT (transacao de dominio) e SELECT (despachante via withTenantTx).
-- O UPDATE de dispatched_at e attempts roda pelo jobs (BYPASSRLS). app_rw nao recebe DELETE.
GRANT SELECT, INSERT ON app.outbox TO app_rw;
GRANT UPDATE (dispatched_at, attempts, last_error) ON app.outbox TO app_rw;

-- RLS: isolamento padrao §3.3
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON app.outbox AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
