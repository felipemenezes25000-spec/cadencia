-- 0083_msg_sent_reminder.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 2 · Bloco 07 — Tabela para rastrear lembretes ja enviados, evitando
-- duplicacao. Referencia: 00-CONTRATOS.md item A6.

CREATE TABLE msg.sent_reminder (
  tenant_id      uuid           NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid           NOT NULL,
  appointment_id uuid           NOT NULL,
  rule_id        uuid           NOT NULL,
  scheduled_at   timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, appointment_id, rule_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, rule_id)
    REFERENCES msg.automation_rule(tenant_id, id)
);
ALTER TABLE msg.sent_reminder OWNER TO app_owner;
GRANT SELECT, INSERT ON msg.sent_reminder TO app_rw;

ALTER TABLE msg.sent_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.sent_reminder FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.sent_reminder AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
