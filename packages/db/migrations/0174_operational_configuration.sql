-- 0174_operational_configuration.sql
-- Notificacoes, configuracao de canais e overrides de permissao usados pelas
-- telas administrativas. Forward-only; executada em uma unica transacao.

CREATE TABLE app.notification (
  tenant_id  uuid NOT NULL DEFAULT app.require_tenant_id(),
  id         uuid NOT NULL,
  user_id    uuid NOT NULL,
  clinic_id  uuid,
  kind       text NOT NULL,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz(3),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (user_id) REFERENCES id."user"(id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  CHECK (jsonb_typeof(data) = 'object')
);
ALTER TABLE app.notification OWNER TO app_owner;
CREATE INDEX ix_notification_inbox
  ON app.notification (tenant_id, user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
GRANT SELECT, UPDATE ON app.notification TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notification TO jobs;
ALTER TABLE app.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_user_isolation ON app.notification AS PERMISSIVE
  FOR ALL TO app_rw
  USING (
    tenant_id = app.current_tenant_id()
    AND user_id = app.current_user_id()
    AND app.is_member()
  )
  WITH CHECK (
    tenant_id = app.require_tenant_id()
    AND user_id = app.current_user_id()
    AND app.is_member()
  );

CREATE TABLE msg.channel_config (
  tenant_id            uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                   uuid NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  status               text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('inactive', 'active', 'suspended', 'pending_verification')),
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_minute integer NOT NULL DEFAULT 60
    CHECK (rate_limit_per_minute BETWEEN 1 AND 10000),
  has_credentials       boolean NOT NULL DEFAULT false,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  CHECK (jsonb_typeof(config) = 'object')
);
ALTER TABLE msg.channel_config OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON msg.channel_config TO app_rw;
ALTER TABLE msg.channel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.channel_config AS PERMISSIVE
  FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE TABLE app.permission_override (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  role      text NOT NULL CHECK (role IN
    ('admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro')),
  action_key text NOT NULL,
  allowed   boolean NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, role, action_key),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (action_key) REFERENCES ref.action(key)
);
ALTER TABLE app.permission_override OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.permission_override TO app_rw;
ALTER TABLE app.permission_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permission_override FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.permission_override AS PERMISSIVE
  FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
