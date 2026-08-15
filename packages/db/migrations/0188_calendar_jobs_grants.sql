-- 0188_calendar_jobs_grants.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- O calendar-sync e um job cross-tenant e por isso usa o papel `jobs`. BYPASSRLS
-- nao substitui GRANT: sem estas permissoes o worker recebe 42501 antes mesmo de
-- a politica RLS entrar em cena.

BEGIN;

GRANT SELECT, UPDATE ON app.calendar_sync TO jobs;
GRANT SELECT ON sched.appointment TO jobs;
GRANT SELECT ON sched.procedure TO jobs;

COMMIT;
