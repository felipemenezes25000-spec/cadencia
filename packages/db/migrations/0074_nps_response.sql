-- 0074_nps_response.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Tabela de respostas NPS e indice de busca por timing para o job de lembretes.
-- A msg.automation_rule ja existe (0073); este arquivo acrescenta a tabela de
-- respostas e o indice auxiliar.

-- =========================================================================
-- msg.nps_response — resposta do paciente a pesquisa NPS
-- =========================================================================
CREATE TABLE msg.nps_response (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,           -- pode ser NULL se NPS avulso
  conversation_id uuid,           -- conversa de onde veio a resposta
  message_id      uuid,           -- mensagem que contem a resposta
  score           smallint NOT NULL CHECK (score >= 0 AND score <= 10),
  comment         text,
  received_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)  REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES msg.conversation(tenant_id, id)
);
ALTER TABLE msg.nps_response OWNER TO app_owner;

CREATE INDEX ix_nps_response_tenant_patient
  ON msg.nps_response (tenant_id, patient_id, received_at DESC);
CREATE INDEX ix_nps_response_tenant_score
  ON msg.nps_response (tenant_id, score, received_at DESC);

GRANT SELECT, INSERT ON msg.nps_response TO app_rw;

ALTER TABLE msg.nps_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.nps_response FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.nps_response AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- =========================================================================
-- Indice em msg.automation_rule para busca por trigger+active
-- (o bloco 02 criou a tabela; este indice acelera o lookup de automacoes)
-- =========================================================================
CREATE INDEX ix_automation_rule_trigger
  ON msg.automation_rule (tenant_id, trigger, active)
  WHERE active = true;
