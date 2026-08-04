-- 0016_identity_credentials.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Identidade GLOBAL (§10 item 2). id."user" e app.membership ja existem desde a
-- 0005: esta migration ESTENDE, nunca recria. O medico tem UM certificado
-- ICP-Brasil, logo UMA identidade; nada aqui tem tenant_id.

-- Colunas que `authn` precisa e que a 0005 nao tinha.
ALTER TABLE id."user"
  ADD COLUMN cpf    varchar(11) CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
  ADD COLUMN status text NOT NULL DEFAULT 'ativo'
             CHECK (status IN ('ativo','suspenso','desativado'));

-- Proveniencia do vinculo: quem concedeu e por que foi revogado. Sem
-- revoked_reason, "o vinculo sumiu" nao tem explicacao em auditoria.
ALTER TABLE app.membership
  ADD COLUMN granted_by     uuid,
  ADD COLUMN revoked_reason text;

CREATE TABLE id.user_credential (
  user_id             uuid PRIMARY KEY REFERENCES id."user"(id),
  password_hash       text NOT NULL,
  password_updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  failed_attempts     int NOT NULL DEFAULT 0,
  locked_until        timestamptz(3)
);
ALTER TABLE id.user_credential OWNER TO app_owner;
COMMENT ON TABLE id.user_credential IS 'global-reference';

-- A aplicacao le e grava a credencial, mas nunca o id do dono: trocar user_id
-- seria transferir a senha de uma pessoa para outra.
GRANT SELECT, INSERT ON id.user_credential TO app_rw;
GRANT UPDATE (password_hash, password_updated_at, failed_attempts, locked_until)
  ON id.user_credential TO app_rw;

-- O papel `jobs` (unico do cluster com BYPASSRLS) monta cenario de teste e roda
-- carga. BYPASSRLS ignora POLICY, NAO ignora GRANT: sem estas linhas toda suite
-- .int.test.ts do repositorio falha com "permission denied for table" (42501).
GRANT USAGE ON SCHEMA app, id TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.tenant            TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.clinic            TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.membership        TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON id."user"             TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON id.user_credential    TO jobs;
