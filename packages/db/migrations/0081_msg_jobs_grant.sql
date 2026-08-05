-- 0081_msg_jobs_grant.sql
-- Fase 2 · design §7.3 — GRANTs para o papel jobs nas tabelas msg.
-- O webhook de mensageria usa jobsPool (BYPASSRLS) para resolver o
-- channel_identity antes de conhecer o tenant. BYPASSRLS ignora
-- POLICY, nao ignora GRANT.
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.

GRANT USAGE ON SCHEMA msg TO jobs;
GRANT SELECT ON msg.channel_identity TO jobs;
GRANT SELECT ON msg.conversation TO jobs;
GRANT SELECT ON msg.message TO jobs;
GRANT SELECT ON msg.inbound_event TO jobs;
