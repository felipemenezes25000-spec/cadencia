-- 0003_fix_role_inherit_option.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- No PostgreSQL 16+ a heranca e gravada POR VINCULO em pg_auth_members.inherit_option.
-- A 0001 executou `CREATE ROLE api LOGIN IN ROLE app_rw` ANTES do `ALTER ROLE api NOINHERIT`,
-- entao o vinculo nasceu com inherit_option = t e o ALTER posterior so mudou
-- pg_roles.rolinherit (o default para vinculos FUTUROS). Resultado: o NOINHERIT de `api`
-- nao tinha efeito nenhum e `api` lia sem SET LOCAL ROLE app_rw.
--
-- NAO corrigimos support->app_support nem app_owner->audit_owner: esses dois vinculos
-- precisam de heranca de proposito (support herda app_support, e app_owner PRECISA
-- herdar audit_owner para o `SET ROLE audit_owner` da 0008 funcionar).
REVOKE app_rw FROM api;
GRANT app_rw TO api WITH INHERIT FALSE;
