-- 0018_totp.sql
-- Segundo fator por TOTP (§2.3: `otpauth`, TOTP sem SMS). SMS nao entra:
-- portabilidade de chip e SIM swap sao vetor conhecido no Brasil, e o fator
-- que chega por SMS protege justamente contra quem ja tem a senha.
CREATE TABLE id.user_totp (
  user_id            uuid PRIMARY KEY REFERENCES id."user"(id),
  secret_ciphertext  bytea NOT NULL,   -- AES-256-GCM, chave em Secrets Manager
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  confirmed_at       timestamptz(3),
  -- Ultimo passo de 30 s ja consumido: e o que impede replay do codigo lido
  -- por cima do ombro dentro da janela de validade.
  last_accepted_step bigint
);
ALTER TABLE id.user_totp OWNER TO app_owner;
COMMENT ON TABLE id.user_totp IS 'global-reference';

GRANT SELECT, INSERT ON id.user_totp TO app_rw;
GRANT UPDATE (secret_ciphertext, confirmed_at, last_accepted_step) ON id.user_totp TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON id.user_totp TO jobs;
