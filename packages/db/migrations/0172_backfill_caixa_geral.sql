-- 0172_backfill_caixa_geral.sql
-- Forward-only: nao existe down migration.
-- Backfill da conta "Caixa Geral" para todos os tenants que ainda nao tem.

BEGIN;

INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
SELECT t.id, gen_random_uuid(), 'Caixa Geral', true
  FROM app.tenant t
 WHERE NOT EXISTS (
   SELECT 1 FROM fin.bank_account ba
    WHERE ba.tenant_id = t.id AND ba.is_default
 );

COMMIT;
