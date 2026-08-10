-- 0002_transaction_context.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

-- ---------------------------------------------------------------------------
-- 1. Extensoes (§2.3). Todas sao "trusted" no PostgreSQL 18 e ficam em public.
--    O docker-compose ja as cria no cluster local; aqui e o que vale em producao
--    e no container descartavel de `pnpm test:iso`.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- btree_gin e obrigatorio: sem ele nao existe indice GIN liderado por tenant_id,
-- e a recepcionista de uma clinica paga o preco do crescimento da base das outras.
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- 2. Schemas. `audit` NAO entra aqui: ele nasce na migration 0008 com
--    AUTHORIZATION audit_owner, que e o que torna a trilha inalcancavel por
--    app_owner e por app_rw.
-- ---------------------------------------------------------------------------
CREATE SCHEMA app   AUTHORIZATION app_owner;   -- plataforma, agenda, identidade de tenant
CREATE SCHEMA clin  AUTHORIZATION app_owner;   -- clinico
CREATE SCHEMA fin   AUTHORIZATION app_owner;   -- financeiro
CREATE SCHEMA tiss  AUTHORIZATION app_owner;   -- convenios
CREATE SCHEMA ref   AUTHORIZATION app_owner;   -- referencia global (CID, TUSS)

-- ---------------------------------------------------------------------------
-- CREATE TRANSITORIO PARA OS DONOS DE OBJETO ESPECIALIZADOS.
--
-- Onze objetos deste schema pertencem a papeis que NAO sao o app_owner:
-- clin_writer (as funcoes SECURITY DEFINER do nucleo clinico), rpt_owner (as
-- matviews) e id_login (o bootstrap de sessao). O PostgreSQL exige que o NOVO
-- dono tenha CREATE no schema para aceitar `ALTER ... OWNER TO`.
--
-- Superusuario ignora essa checagem, e por isso o cluster local nunca precisou
-- disto. Postgres gerenciado (Supabase) nao ignora, e a migration 0037 morre
-- com "permission denied for schema clin".
--
-- A concessao e TRANSITORIA: a ultima migration da cadeia (0134) revoga, e o
-- estado final de privilegio e exatamente o mesmo de antes. O invariante 7
-- afirma isso tabela a tabela contra privileges.json.
GRANT CREATE ON SCHEMA clin TO clin_writer;
-- id_login nasce so na 0132, junto com o schema `id`: a concessao dele mora la.
CREATE SCHEMA id    AUTHORIZATION app_owner;   -- identidade global, sem tenant_id
CREATE SCHEMA rpt   AUTHORIZATION rpt_owner;   -- matviews; app_rw nunca recebe GRANT aqui

-- A 0001 revogou USAGE de public do pseudo-papel PUBLIC. Devolvemos USAGE (nunca
-- CREATE) nominalmente, senao pg_trgm, citext e unaccent ficam inalcancaveis.
GRANT USAGE ON SCHEMA public TO app_rw, clin_writer, audit_owner, rpt_owner, app_support;
GRANT USAGE ON SCHEMA app, clin, fin, tiss, ref, id TO app_rw, clin_writer, app_support;
GRANT USAGE ON SCHEMA app TO audit_owner, rpt_owner;

-- ---------------------------------------------------------------------------
-- 3. Leitura do contexto (§3.2).
--    TODA leitura de GUC usa nullif(..., ''), sem excecao: o ator de sistema e o
--    anonimo nao tem user_id, e ''::uuid levanta 22P02 e aborta a transacao.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app.require_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE t uuid := app.current_tenant_id();
BEGIN IF t IS NULL THEN RAISE EXCEPTION 'contexto de tenant ausente' USING ERRCODE='42501'; END IF;
      RETURN t; END $$;

ALTER FUNCTION app.current_tenant_id() OWNER TO app_owner;
ALTER FUNCTION app.current_user_id()   OWNER TO app_owner;
ALTER FUNCTION app.require_tenant_id() OWNER TO app_owner;
