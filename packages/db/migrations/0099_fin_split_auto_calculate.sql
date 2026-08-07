-- 0099_fin_split_auto_calculate.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · permite que recordPayment chame fin.calculate_splits na mesma tx.
-- A funcao ja existe (migration 0096). Aqui so garantimos os GRANTs
-- necessarios para que app_rw possa chamar a funcao de calculo de splits
-- e que o trigger de validacao funcione corretamente.

-- Garantir que app_rw pode INSERT em fin.split via a funcao SECURITY DEFINER
-- A funcao fin.calculate_splits ja e SECURITY DEFINER e roda como app_owner,
-- entao ela ja tem acesso. Apenas garantimos que a GRANT EXECUTE esta correta.
GRANT EXECUTE ON FUNCTION fin.calculate_splits(uuid, uuid) TO app_rw;

-- Indice para performance do calculo: buscar entry por tenant e id rapidamente
-- (ja coberto pelo indice primario, mas explicitamos para documentacao).
-- Nenhum indice novo necessario.
