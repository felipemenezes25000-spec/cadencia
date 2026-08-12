-- 0173_ensure_billing_test_caixa_geral.sql
-- Garante que o tenant de teste de billing tenha sua conta Caixa Geral.

BEGIN;

-- Primeiro cria o tenant (se não existir)
INSERT INTO app.tenant (id, slug, razao_social, cnpj)
VALUES ('01940000-0000-7000-8000-100000000001', 'billing-test', 'Billing Test Ltda', '99BBB99999BC99')
ON CONFLICT (id) DO NOTHING;

-- Depois cria a conta Caixa Geral
INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
VALUES ('01940000-0000-7000-8000-100000000001', gen_random_uuid(), 'Caixa Geral', true)
ON CONFLICT DO NOTHING;

COMMIT;
