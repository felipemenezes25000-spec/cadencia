-- Roda UMA vez, quando o volume e criado. As seis extensoes contrib abaixo (ate
-- citext) entram tambem pela migration 0002 — e e a migration que vale em producao
-- e no test:iso; aqui e so para o cluster de desenvolvimento nascer pronto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_stat_statements e DEV-ONLY: nao faz parte da migration 0002 nem de nenhuma das
-- 48 tarefas da Fase 0. Em producao, habilitar pg_stat_statements e provisionamento
-- de infra (parameter group do RDS + restart da instancia), nao migration — fica
-- para uma tarefa de infra decidir como isso entra em RDS.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- pg_partman (setima extensao da secao 2.3) NAO entra aqui: nao acompanha a imagem
-- oficial postgres:18. A Fase 0 particiona com DDL declarativa nativa; a manutencao
-- automatica de particao entra no bloco de migrations, junto com uma imagem propria
-- (FROM postgres:18 + build de pg_partman) usada tanto no compose quanto em RDS.

-- Cluster em UTC. A data do evento vem de occurred_date, derivada do fuso da
-- clinica na escrita; nenhuma derivacao diaria usa timestamptz::date.
ALTER DATABASE cadencia SET timezone TO 'UTC';
