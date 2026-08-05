-- 0073_msg_automation_rule.sql
-- Fase 2 · design §5.3 secao CONVERSAS — automacoes.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Uma regra de automacao diz: "quando ocorrer ESTE gatilho, enviar ESTE template
-- pelo canal DESTA identidade, com ESTE offset de tempo". timing_offset_minutes
-- negativo significa ANTES do evento (e.g., -1440 = 24h antes do agendamento).

CREATE TABLE msg.automation_rule (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  trigger             text NOT NULL
    CHECK (trigger IN (
      'appointment_created',
      'appointment_reminder',
      'encounter_finalized',
      'nps_due')),
  template_id         uuid NOT NULL,
  timing_offset_minutes int NOT NULL DEFAULT 0,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, channel_identity_id)
    REFERENCES msg.channel_identity(tenant_id, id),
  FOREIGN KEY (tenant_id, template_id)
    REFERENCES msg.template(tenant_id, id));
ALTER TABLE msg.automation_rule OWNER TO app_owner;

-- Uma regra ativa por trigger por canal identity.
CREATE UNIQUE INDEX ux_automation_rule_trigger
  ON msg.automation_rule (tenant_id, channel_identity_id, trigger)
  WHERE active = true;

GRANT SELECT, INSERT, UPDATE ON msg.automation_rule TO app_rw;

ALTER TABLE msg.automation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.automation_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.automation_rule AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
