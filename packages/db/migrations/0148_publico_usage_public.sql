-- 0148_publico_usage_public.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- `sched_public` nasceu em 0146 sem USAGE no schema `public` e falhava com
-- "permission denied for schema public" ao inserir. Todos os outros papeis de
-- aplicacao — `app_rw`, `clin_writer`, `jobs` — ja tem, porque o cluster usa
-- `public` para o que o Postgres resolve por padrao (funcoes de extensao,
-- expressoes de indice, colunas geradas).
--
-- Isto NAO amplia o que o papel enxerga: `public` nao tem tabela de dado nossa,
-- e todo o acesso continua passando pelas duas funcoes SECURITY DEFINER. E
-- alinhamento com os demais papeis, e nao excecao para este.

GRANT USAGE ON SCHEMA public TO sched_public;
