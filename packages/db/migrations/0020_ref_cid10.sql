-- 0020_ref_cid10.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Terminologia GLOBAL, versionada por data (§3.9, §10 item 11).
-- Sem RLS e sem tenant_id: 15 mil codigos x N clinicas seria absurdo, e a CID
-- e a mesma para todo mundo. Usa btree_gist (para o operador `=` participar do
-- EXCLUDE ao lado do `&&` do daterange) e pg_trgm (gin_trgm_ops); as duas ja
-- foram instaladas pela migration 0002.
CREATE TABLE ref.cid10_term (
  codigo      varchar(6) NOT NULL,
  descricao   text NOT NULL,
  capitulo    smallint,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,          -- AAAAMM da publicacao carregada
  PRIMARY KEY (codigo, vigencia),
  -- Impossivel carregar uma competencia que sobreponha a vigencia do mesmo codigo.
  -- Sem isto, duas linhas concorrentes fariam o lookup devolver a que o planejador
  -- escolher -- e a descricao do prontuario mudaria entre duas impressoes.
  EXCLUDE USING gist (codigo WITH =, vigencia WITH &&)
);
ALTER TABLE ref.cid10_term OWNER TO app_owner;
COMMENT ON TABLE ref.cid10_term IS 'global-reference';

CREATE INDEX ix_cid10_busca ON ref.cid10_term USING gin (descricao gin_trgm_ops);

-- Lookup PELA DATA DO EVENTO. Repare que nao existe versao sem parametro de
-- data: quem chama e obrigado a dizer de quando e o atendimento.
CREATE FUNCTION ref.cid10_at(p_codigo varchar, p_data date)
RETURNS ref.cid10_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.cid10_term
   WHERE codigo = p_codigo AND vigencia @> p_data $$;
ALTER FUNCTION ref.cid10_at(varchar, date) OWNER TO app_owner;

GRANT USAGE  ON SCHEMA ref TO app_rw;
GRANT SELECT ON ref.cid10_term TO app_rw;
GRANT EXECUTE ON FUNCTION ref.cid10_at(varchar, date) TO app_rw;
-- USAGE no schema e SELECT sao obrigatorios: sem USAGE nada em `ref` e alcancavel,
-- e o `DELETE ... WHERE codigo IN (...)` do fixture le as colunas do predicado.
-- A carga bimestral e job, nunca caminho de requisicao.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, DELETE ON ref.cid10_term TO jobs;
