-- 0103_outbox_jobs_insert_grant.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Estoque — GRANT INSERT em app.outbox para o papel jobs.
-- O stock alert job (runStockAlertJob) enfileira eventos STOCK_LOW
-- diretamente no outbox. O papel jobs ja tinha SELECT, UPDATE
-- (migration 0070); agora ganha INSERT tambem.

GRANT INSERT ON app.outbox TO jobs;
