-- 0084_worker_jobs_grants.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 2 · Bloco 07 — GRANTs adicionais para o papel jobs, necessarios
-- pelos worker jobs de lembretes, outbox dispatcher e daily rollup.
-- BYPASSRLS ignora POLICY, nao ignora GRANT.

-- O reminder-scheduler precisa ler regras de automacao e gravar lembretes enviados
GRANT SELECT ON msg.automation_rule TO jobs;
GRANT SELECT, INSERT ON msg.sent_reminder TO jobs;

-- O reminder-scheduler precisa ler agendamentos e pacientes
GRANT USAGE ON SCHEMA sched TO jobs;
GRANT SELECT ON sched.appointment TO jobs;
GRANT SELECT ON clin.patient TO jobs;

-- O send-message job usa withTenantTx (app_rw), nao precisa de grant para jobs.
-- O outbox dispatcher ja tem SELECT, UPDATE em app.outbox (migration 0070).
-- O daily-rollup usa fin.refresh_daily_rollup (SECURITY DEFINER), mas tambem
-- precisa de SELECT em fin.entry para a query direta do rollup.
-- jobs ja tem SELECT em fin.entry (migration 0082).

-- O daily-rollup job precisa de UPDATE em msg.message para o send-message
GRANT UPDATE ON msg.message TO jobs;
