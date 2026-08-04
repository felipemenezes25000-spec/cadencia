-- 0053_signature_pending.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.5 fluxo (b) — a assinatura NAO BLOQUEIA. Se o PSC nao responde, o
-- atendimento finaliza e a pendencia vai para "Precisa de voce". Erro de
-- terceiro nunca vira erro de fluxo.
--
-- `motivo` guarda o `kind` do ProviderFailure. `timeout` NUNCA e reprocessado
-- automaticamente: o estado no parceiro e DESCONHECIDO e o job de reconciliacao
-- precisa consultar antes de reenviar.

CREATE TABLE clin.signature_pending (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  clinic_id     uuid NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN
                  ('encounter_version','document','prescription')),
  subject_id    uuid NOT NULL,
  canonical_key uuid NOT NULL,
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  signer_user_id uuid NOT NULL,
  motivo        text NOT NULL CHECK (motivo IN
                  ('unavailable','timeout','rejected','misconfigured','unsupported')),
  detalhe       text NOT NULL,
  tentativas    int NOT NULL DEFAULT 1 CHECK (tentativas >= 1),
  precisa_reconciliar boolean NOT NULL,
  resolved_at   timestamptz(3),
  signature_id  uuid,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_id) REFERENCES clin.signature(tenant_id, id),
  CHECK ((resolved_at IS NULL) = (signature_id IS NULL)));
ALTER TABLE clin.signature_pending OWNER TO app_owner;

CREATE UNIQUE INDEX ux_signature_pending_aberta
  ON clin.signature_pending (tenant_id, subject_kind, subject_id) WHERE resolved_at IS NULL;
CREATE INDEX ix_signature_pending_painel
  ON clin.signature_pending (tenant_id, clinic_id, created_at) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.signature_pending TO app_rw;

ALTER TABLE clin.signature_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.signature_pending FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.signature_pending AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
