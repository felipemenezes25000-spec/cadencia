-- 0071_msg_schema_channel_template.sql
-- Fase 2 · design §7.3 e §5.3 — mensageria.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- O schema `msg` nasce aqui, com o mesmo dono e padrao de GRANT dos demais.
-- A identidade de canal e POR TENANT: a clinica e dona do WABA, nao nos.

CREATE SCHEMA msg AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA msg TO app_rw, clin_writer, app_support;

-- ---------------------------------------------------------------------------
-- msg.channel_identity — canal da clinica (WhatsApp, SMS, email)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.channel_identity (
  tenant_id      uuid NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid NOT NULL,
  channel        text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  display_name   text NOT NULL,
  phone          text NOT NULL,           -- E.164
  waba_ref       text,                   -- WABA ID da Meta, opcional
  provider_ref   text,                   -- referencia do provedor
  status         text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','active','suspended','blocked','verified')),
  quality_rating text,                   -- WhatsApp business quality rating
  created_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id));
ALTER TABLE msg.channel_identity OWNER TO app_owner;

-- Telefone unico por canal dentro do tenant.
CREATE UNIQUE INDEX ux_channel_identity_phone
  ON msg.channel_identity (tenant_id, channel, phone);

GRANT SELECT, INSERT, UPDATE ON msg.channel_identity TO app_rw;

ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.channel_identity AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.template — templates de mensagem aprovados pela Meta
-- ---------------------------------------------------------------------------
CREATE TABLE msg.template (
  tenant_id          uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                 uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  channel            text NOT NULL CHECK (channel IN ('whatsapp')),
  name               text NOT NULL,
  language           text NOT NULL DEFAULT 'pt_BR',
  category           text NOT NULL CHECK (category IN ('marketing','utility','authentication')),
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  body_template      text NOT NULL,
  header_template    text,
  footer_template    text,
  variables          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.template OWNER TO app_owner;

-- Nome unico por canal identity + idioma.
CREATE UNIQUE INDEX ux_template_name
  ON msg.template (tenant_id, channel_identity_id, name, language);

GRANT SELECT, INSERT, UPDATE ON msg.template TO app_rw;

ALTER TABLE msg.template ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.template FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.template AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
