-- 0088_fin_bank_account_seed_default.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Provisiona a conta sentinela "Caixa Geral" para cada tenant existente e para
-- todo tenant novo criado a partir de agora.
-- A conta sentinela e a default (is_default = true) e nao pode ser desativada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Policy para app_owner: com FORCE ROW LEVEL SECURITY o proprio dono e
--    filtrado. Sem esta policy a funcao SECURITY DEFINER abaixo (que roda como
--    app_owner) nao conseguiria inserir — exatamente o mesmo padrao de
--    audit.event (0010_audit_grants_rls.sql).
-- ---------------------------------------------------------------------------
CREATE POLICY provisioner ON fin.bank_account AS PERMISSIVE FOR INSERT TO app_owner
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 1. Funcao de provisionamento — SECURITY DEFINER para acessar fin.bank_account
--    sem depender do preambulo RLS (INSERT no tenant novo acontece ANTES de
--    qualquer withTenantTx).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fin.provision_default_bank_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, app, pg_catalog AS $$
BEGIN
  INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
  VALUES (NEW.id, gen_random_uuid(), 'Caixa Geral', true);
  RETURN NEW;
END;
$$;

ALTER FUNCTION fin.provision_default_bank_account() OWNER TO app_owner;

CREATE TRIGGER trg_tenant_default_bank_account
  AFTER INSERT ON app.tenant
  FOR EACH ROW
  EXECUTE FUNCTION fin.provision_default_bank_account();

-- ---------------------------------------------------------------------------
-- 2. Backfill: tenants existentes que ainda nao tem conta default
-- ---------------------------------------------------------------------------
INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
SELECT t.id, gen_random_uuid(), 'Caixa Geral', true
  FROM app.tenant t
 WHERE NOT EXISTS (
   SELECT 1 FROM fin.bank_account ba
    WHERE ba.tenant_id = t.id AND ba.is_default
 );

COMMIT;
