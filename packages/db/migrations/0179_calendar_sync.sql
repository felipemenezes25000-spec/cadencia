-- Migration 0179: calendar_sync — tabela + RLS

CREATE TABLE app.calendar_sync (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES app.tenant(id),
  user_id           uuid NOT NULL REFERENCES id."user"(id),
  provider          text NOT NULL CHECK (provider IN ('google', 'apple', 'outlook')),
  external_id       text,
  access_token_enc  bytea,
  refresh_token_enc bytea,
  last_sync_at      timestamptz(3),
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, user_id, provider)
);

ALTER TABLE app.calendar_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_sync_own ON app.calendar_sync
  USING (user_id = app.current_user_id());
