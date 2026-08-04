-- 0001_roles.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

-- §3.1 Papeis — a fundacao.
--
-- Papeis funcionais (NOLOGIN): sao alvo de GRANT e de POLICY, nunca abrem conexao.
CREATE ROLE app_owner   NOLOGIN;   -- dono do schema, roda migrations, sem login em runtime
CREATE ROLE app_rw      NOLOGIN;   -- papel funcional da aplicacao, sujeito a RLS
CREATE ROLE clin_writer NOLOGIN;   -- unico com INSERT no nucleo clinico; funcoes SECURITY DEFINER
CREATE ROLE audit_owner NOLOGIN;   -- dono exclusivo do schema audit
CREATE ROLE rpt_owner   NOLOGIN;   -- dono das matviews; app_rw nao tem GRANT nelas
-- app_support NAO consta do trecho literal da spec, mas `support` e criado IN ROLE
-- app_support e a §9 o cita como o papel do break-glass. Sem esta linha o SQL nao roda.
CREATE ROLE app_support NOLOGIN;   -- break-glass do suporte, sem escrita clinica

-- Papeis de login: abrem conexao, nao possuem relacao nenhuma.
CREATE ROLE api     LOGIN IN ROLE app_rw;      -- pool da aplicacao
CREATE ROLE support LOGIN IN ROLE app_support; -- break-glass, pool separado
CREATE ROLE jobs    LOGIN;                     -- UNICO papel com BYPASSRLS

ALTER ROLE api     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE support NOSUPERUSER NOBYPASSRLS;
ALTER ROLE jobs    NOSUPERUSER BYPASSRLS;      -- selo, drift, expurgo, partman, carga TUSS
ALTER ROLE api SET row_security = on;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- A migration da trilha (0008) faz `SET ROLE audit_owner` para que o schema audit
-- nasca com dono proprio. Em producao as migrations rodam como app_owner, que
-- precisa ser MEMBRO de audit_owner — senao o SET ROLE falha com 42501 e a trilha
-- nunca e criada. Localmente rodamos como superusuario, mas a dependencia e a mesma.
GRANT audit_owner TO app_owner;

-- Por que `api` e NOINHERIT: ser membro de app_rw sem herdar obriga a transacao a
-- executar SET LOCAL ROLE app_rw. Codigo que nao passa pelo preambulo de
-- packages/db/src/tx.ts recebe `permission denied`, nao dado de outro tenant.
--
-- Por que `api` nunca sera dono de relacao: o dono de uma tabela pode executar
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY e DROP POLICY. Dono e login sao
-- separados exatamente para que o papel exposto a internet nao possa desligar a RLS.
--
-- Por que `jobs` tem BYPASSRLS: o selo diario da auditoria, o detector de divergencia
-- do financeiro e a carga bimestral da TUSS precisam ver todos os tenants. Sem
-- BYPASSRLS eles veriam zero linhas e reportariam sucesso para sempre.
