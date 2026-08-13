-- 0175_permission_override_catalog_fk.sql
-- A remoção de uma ação do catálogo remove também customizações órfãs. Sem o
-- CASCADE, o próprio authz:seed falhava ao aposentar uma ação versionada.

ALTER TABLE app.permission_override
  DROP CONSTRAINT permission_override_action_key_fkey;

ALTER TABLE app.permission_override
  ADD CONSTRAINT permission_override_action_key_fkey
  FOREIGN KEY (action_key) REFERENCES ref.action(key) ON DELETE CASCADE;
