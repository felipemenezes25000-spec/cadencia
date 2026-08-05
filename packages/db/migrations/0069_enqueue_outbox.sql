-- 0069_enqueue_outbox.sql
-- Fase 2 · design §7.1 — funcao de enfileiramento transacional.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

CREATE FUNCTION app.enqueue_outbox(
  p_event_type   text,
  p_aggregate_id uuid,
  p_payload      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = app, pg_catalog AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO app.outbox (tenant_id, id, event_type, aggregate_id, payload)
  VALUES (app.require_tenant_id(), v_id, p_event_type, p_aggregate_id, p_payload);
  RETURN v_id;
END $$;

ALTER FUNCTION app.enqueue_outbox(text, uuid, jsonb) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.enqueue_outbox(text, uuid, jsonb) TO app_rw;
GRANT EXECUTE ON FUNCTION app.enqueue_outbox(text, uuid, jsonb) TO clin_writer;
