-- 0147_publico_usage_id.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- 0146 concedeu SELECT em `id."user"` a `sched_public` e esqueceu o USAGE no
-- schema `id`. GRANT em tabela nao vale nada sem USAGE no schema onde ela mora,
-- e o erro sai como "permission denied for schema id" — que aponta para o
-- schema e nao para o GRANT faltante.
--
-- `id."user"` NAO tem RLS: e cadastro global de identidade, isolado por
-- membership e nao por linha. Por isso o publico so alcanca o nome pela funcao
-- `sched.horarios_livres`, que ja filtra por vinculo ativo na unidade — e nunca
-- por SELECT direto.

GRANT USAGE ON SCHEMA id TO sched_public;
