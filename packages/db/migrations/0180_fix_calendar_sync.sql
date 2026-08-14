-- 0180_fix_calendar_sync.sql
-- Forward-only: corrige 0179 — faltava FORCE RLS, OWNER, GRANT e WITH CHECK.

ALTER TABLE app.calendar_sync OWNER TO app_owner;
ALTER TABLE app.calendar_sync FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.calendar_sync TO app_rw;

DROP POLICY IF EXISTS calendar_sync_own ON app.calendar_sync;
CREATE POLICY calendar_sync_tenant ON app.calendar_sync AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.require_tenant_id() AND user_id = app.current_user_id());
