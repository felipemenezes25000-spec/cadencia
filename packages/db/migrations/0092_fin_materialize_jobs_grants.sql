-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — GRANTs para o job de materializacao de recorrentes.
-- O job materializeRecurringEntries roda como `jobs` (BYPASSRLS) e precisa
-- INSERT em fin.entry, SELECT em app.professional e fin.payment_method.

-- jobs precisa inserir entries materializadas a partir de templates recorrentes
GRANT INSERT ON fin.entry TO jobs;

-- Subqueries do job: busca profissional e metodo de pagamento do tenant
GRANT SELECT ON app.professional TO jobs;
GRANT SELECT ON fin.payment_method TO jobs;
