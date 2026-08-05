-- 0072_msg_conversation_message.sql
-- Fase 2 . design 7.3 -- conversas, mensagens e eventos de entrada.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- msg.conversation.patient_id e NULLABLE: numero desconhecido nao e vinculado
-- automaticamente (privacidade). resolveConversation faz lookup pelo telefone do
-- paciente quando cria uma conversa nova, mas nunca para numero novo sem match.
--
-- msg.inbound_event e append-only: o payload bruto do webhook e gravado ANTES de
-- parsear -- parser bugado nao perde mensagem de paciente.

-- ---------------------------------------------------------------------------
-- msg.conversation -- conversa com paciente, keyed por NOSSO id
-- ---------------------------------------------------------------------------
CREATE TABLE msg.conversation (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  patient_id          uuid,              -- NULLABLE: numero desconhecido
  remote_phone        varchar(20) NOT NULL,  -- E.164 do paciente/contato
  external_ref        text,              -- id do parceiro (WhatsApp conversation id)
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  last_message_at     timestamptz(3),
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id));
ALTER TABLE msg.conversation OWNER TO app_owner;

-- Busca por telefone para resolveConversation: uma conversa ativa por telefone.
CREATE UNIQUE INDEX ux_conversation_phone
  ON msg.conversation (tenant_id, channel_identity_id, remote_phone)
  WHERE status = 'active';
-- Busca por paciente.
CREATE INDEX ix_conversation_patient
  ON msg.conversation (tenant_id, patient_id) WHERE patient_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.conversation TO app_rw;

ALTER TABLE msg.conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.conversation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.conversation AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.message -- mensagem individual (inbound ou outbound)
-- ---------------------------------------------------------------------------
CREATE TABLE msg.message (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  body_text       text,
  body_media_key  text,                -- storage ref (StorageKey)
  template_key    text,                -- se veio de template
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','read','failed')),
  external_id     text,                -- providerMessageId
  sent_at         timestamptz(3),
  delivered_at    timestamptz(3),
  read_at         timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES msg.conversation(tenant_id, id));
ALTER TABLE msg.message OWNER TO app_owner;

-- Timeline de mensagens de uma conversa.
CREATE INDEX ix_message_conversation
  ON msg.message (tenant_id, conversation_id, created_at DESC);
-- Lookup por external_id para status updates do webhook.
CREATE INDEX ix_message_external
  ON msg.message (tenant_id, external_id) WHERE external_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON msg.message TO app_rw;

ALTER TABLE msg.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.message AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- msg.inbound_event -- payload bruto do webhook, append-only
-- ---------------------------------------------------------------------------
CREATE TABLE msg.inbound_event (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  raw_payload         jsonb NOT NULL,
  received_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  processed_at        timestamptz(3),
  error               text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id));
ALTER TABLE msg.inbound_event OWNER TO app_owner;

-- Eventos pendentes de processamento.
CREATE INDEX ix_inbound_event_pending
  ON msg.inbound_event (tenant_id, channel_identity_id, received_at)
  WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON msg.inbound_event TO app_rw;

ALTER TABLE msg.inbound_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.inbound_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.inbound_event AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
