-- 0019_action_catalog.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Espelho do catalogo de acoes no banco, para consulta operacional e para a
-- tela de papeis. NAO e fonte da verdade: packages/authz/src/actions.ts e.
-- Fica em `ref` (referencia global, sem tenant) e nao em `app`, porque o
-- catalogo e igual para todos os tenants.
CREATE TABLE ref.action (
  key          text PRIMARY KEY,
  description  text NOT NULL,
  roles        text[] NOT NULL,
  requires_mfa boolean NOT NULL DEFAULT false,
  generated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE ref.action OWNER TO app_owner;
COMMENT ON TABLE ref.action IS 'global-reference';

GRANT USAGE  ON SCHEMA ref TO app_rw;
GRANT SELECT ON ref.action TO app_rw;
-- `pnpm authz:seed` roda como `jobs`: BYPASSRLS ignora POLICY, nao ignora GRANT.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON ref.action TO jobs;
