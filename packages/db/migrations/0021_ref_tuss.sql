-- 0021_ref_tuss.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Terminologia TUSS GLOBAL, versionada por data (§3.9, §8 Fase 0, §10 item 11).
-- Sem RLS e sem tenant_id: 200 mil linhas x N clinicas seria absurdo, e a tabela
-- da ANS e a mesma para todo mundo. O EXCLUDE exige btree_gist (instalada na
-- 0002) para o operador `=` participar ao lado do `&&` do daterange.
CREATE TABLE ref.tuss_term (
  tabela      smallint NOT NULL,
  codigo      varchar(10) NOT NULL,
  termo       text NOT NULL,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,     -- AAAAMM da publicacao da ANS
  acao        text NOT NULL,        -- inclusao / alteracao / exclusao, como vem da ANS
  PRIMARY KEY (tabela, codigo, vigencia),
  -- Impossivel carregar competencia da ANS que sobreponha vigencias do mesmo codigo.
  EXCLUDE USING gist (tabela WITH =, codigo WITH =, vigencia WITH &&)
);
ALTER TABLE ref.tuss_term OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_term IS 'global-reference';

CREATE INDEX ix_tuss_busca ON ref.tuss_term USING gin (termo gin_trgm_ops);

-- Lookup PELA DATA DO EVENTO: nao existe versao sem parametro de data.
CREATE FUNCTION ref.tuss_at(p_tabela smallint, p_codigo varchar, p_data date)
RETURNS ref.tuss_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.tuss_term
   WHERE tabela = p_tabela AND codigo = p_codigo AND vigencia @> p_data $$;
ALTER FUNCTION ref.tuss_at(smallint, varchar, date) OWNER TO app_owner;

GRANT USAGE   ON SCHEMA ref TO app_rw;
GRANT SELECT  ON ref.tuss_term TO app_rw;
GRANT EXECUTE ON FUNCTION ref.tuss_at(smallint, varchar, date) TO app_rw;
-- Carga bimestral e job, nunca caminho de requisicao.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, DELETE ON ref.tuss_term TO jobs;
