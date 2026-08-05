-- 0070_outbox_jobs_grant.sql
-- Fase 2 · design §7.1 — GRANTs para o papel jobs na tabela app.outbox.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- O worker de despacho roda com o papel jobs (BYPASSRLS) para ler eventos
-- de TODOS os tenants. Precisa de SELECT para fetchPending e UPDATE para
-- markDispatched / markFailed.

GRANT SELECT, UPDATE ON app.outbox TO jobs;
