-- 0134_revogar_create_transitorio.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- FECHA A PORTA QUE A 0002 ABRIU.
--
-- A 0002 concede CREATE nos schemas para clin_writer, rpt_owner e id_login
-- porque o PostgreSQL exige que o novo dono tenha CREATE no schema para aceitar
-- `ALTER ... OWNER TO` — e superusuario ignora a checagem, mas Postgres
-- gerenciado nao. As onze transferencias de posse ja aconteceram nas migrations
-- 0037 a 0133; a partir daqui a permissao e so superficie.
--
-- clin_writer com CREATE em `clin` poderia, atraves de uma funcao SECURITY
-- DEFINER nossa que executasse DDL dinamica, criar objeto no nucleo clinico.
-- Nenhuma funcao nossa faz isso hoje. Revogar significa que nenhuma podera
-- fazer amanha, mesmo que alguem escreva uma sem perceber.
REVOKE CREATE ON SCHEMA clin FROM clin_writer;
REVOKE CREATE ON SCHEMA app, id FROM id_login;
