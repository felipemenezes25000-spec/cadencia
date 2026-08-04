-- 0017_session.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Sessao OPACA (§8 Fase 0). Token aleatorio de 32 bytes entregue ao navegador;
-- no banco fica so o sha256. Nunca JWT com claim de tenant: claim assinada nao
-- se revoga, e desligamento, revogacao de vinculo e break-glass exigem revogacao
-- com efeito imediato.
--
-- Fica no schema `id`, que e global e sem RLS: e por isso que a sessao pode ser
-- resolvida ANTES de existir contexto de tenant. Em `app` a resolucao dependeria
-- do tenant que ainda nao foi escolhido.
CREATE TABLE id.session (
  -- uuidv7() nativo do PostgreSQL 18: `authn` nao pode importar o gerador do
  -- kernel (irmaos em L0, §2.2) e duplicar o algoritmo seria pior.
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id             uuid NOT NULL REFERENCES id."user"(id),
  token_hash          bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  -- Tenant ativo da sessao: e LINHA DE BANCO, revogavel, nao claim assinada.
  active_tenant_id    uuid REFERENCES app.tenant(id),
  active_clinic_id    uuid,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  last_seen_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  idle_expires_at     timestamptz(3) NOT NULL,
  absolute_expires_at timestamptz(3) NOT NULL,
  revoked_at          timestamptz(3),
  revoked_reason      text,
  mfa_at              timestamptz(3),
  ip                  inet,
  user_agent_hash     bytea
);
ALTER TABLE id.session OWNER TO app_owner;
COMMENT ON TABLE id.session IS 'global-reference';

CREATE INDEX ix_session_user_vivo ON id.session (user_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT ON id.session TO app_rw;
-- Sem UPDATE em user_id nem em token_hash: trocar qualquer um dos dois seria
-- transferir a sessao de uma pessoa para outra.
GRANT UPDATE (last_seen_at, idle_expires_at, revoked_at, revoked_reason,
              active_tenant_id, active_clinic_id, mfa_at) ON id.session TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON id.session TO jobs;
