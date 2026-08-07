-- 0114_ref_tuss_term_grant_update_jobs.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Concede UPDATE em ref.tuss_term para o papel `jobs`. O job de carga bimestral
-- (loadTussCompetenciaSafe) usa INSERT ... ON CONFLICT DO UPDATE para fazer merge
-- da staging; sem UPDATE o PostgreSQL nega a operacao.

GRANT UPDATE ON ref.tuss_term TO jobs;
