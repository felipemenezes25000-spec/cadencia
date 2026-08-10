-- 0153_ref_cid11.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- CID-11 (ICD-11 MMS). Tabela IRMA de `ref.cid10_term`, nao substituta.
--
-- As duas convivem por tempo indeterminado, servindo a donos diferentes:
--   - CID-11 entra na vigilancia epidemiologica em 01/01/2027 (Nota Tecnica
--     91/2024 do Ministerio da Saude);
--   - CID-10 continua no faturamento de convenio enquanto o padrao TISS pedir
--     `dm_diagnosticoCID10` — que e o que a versao 4.03.00 pede hoje.
-- Migrar diagnostico antigo para o codigo novo nunca acontece: `clin.diagnosis`
-- e append-only e guarda `code_system`, entao o que foi registrado em CID-10
-- permanece CID-10 para sempre.
--
-- TRES DIFERENCAS ESTRUTURAIS EM RELACAO A CID-10, e nenhuma e cosmetica:
--
-- 1. `uri` e a identidade estavel, nao o codigo. Na CID-11 o codigo pertence a
--    LINEARIZACAO e pode mudar entre releases; a entidade da fundacao, apontada
--    pela URI, sobrevive. Guardar so o codigo faria o sistema perder o rastro de
--    um diagnostico quando a OMS recodificasse a entidade.
--
-- 2. `capitulo` e TEXTO. A CID-11 tem os capitulos V (funcionalidade) e X
--    (codigos de extensao) — letras. O smallint da CID-10 nao os representa.
--
-- 3. Codigo mais longo e alfanumerico com ponto ('1A00.0Z'). varchar(12) cobre o
--    codigo-tronco com folga.
--
-- FORA DE ESCOPO NESTA MIGRATION: pos-coordenacao. A CID-11 permite agrupar
-- codigos em cluster ('&' e '/') para descrever um quadro que nenhum codigo
-- isolado cobre. Isso e composicao no MOMENTO DO DIAGNOSTICO, nao catalogo, e
-- pertence a `clin.diagnosis` — nao a esta tabela de termos.
CREATE TABLE ref.cid11_term (
  -- URI da entidade na fundacao, ex.: 'http://id.who.int/icd/entity/1435254666'
  uri         text NOT NULL,
  codigo      varchar(12) NOT NULL,
  descricao   text NOT NULL,
  capitulo    varchar(2),
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,          -- AAAAMM do release da OMS carregado
  PRIMARY KEY (codigo, vigencia),
  -- Mesmo motivo da CID-10: duas linhas com vigencia sobreposta fariam o lookup
  -- devolver a que o planejador escolher, e a descricao do prontuario mudaria
  -- entre duas impressoes do mesmo documento.
  EXCLUDE USING gist (codigo WITH =, vigencia WITH &&)
);
ALTER TABLE ref.cid11_term OWNER TO app_owner;
COMMENT ON TABLE ref.cid11_term IS 'global-reference';

COMMENT ON COLUMN ref.cid11_term.uri IS
  'Identidade ESTAVEL da entidade. O codigo pertence a linearizacao e pode mudar entre releases da OMS; a URI da fundacao sobrevive.';

CREATE INDEX ix_cid11_busca ON ref.cid11_term USING gin (descricao gin_trgm_ops);
-- Buscar pela URI acontece na reconciliacao entre releases, nao no atendimento.
CREATE INDEX ix_cid11_uri ON ref.cid11_term (uri);

-- Lookup PELA DATA DO EVENTO, igual a CID-10: nao existe versao sem data.
-- Resolver pelo relogio de quem executa e o erro que so aparece meses depois.
CREATE FUNCTION ref.cid11_at(p_codigo varchar, p_data date)
RETURNS ref.cid11_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.cid11_term
   WHERE codigo = p_codigo AND vigencia @> p_data $$;
ALTER FUNCTION ref.cid11_at(varchar, date) OWNER TO app_owner;

GRANT SELECT ON ref.cid11_term TO app_rw;
GRANT EXECUTE ON FUNCTION ref.cid11_at(varchar, date) TO app_rw;
-- A carga e job, nunca caminho de requisicao: sao dezenas de milhares de linhas.
GRANT SELECT, INSERT, DELETE ON ref.cid11_term TO jobs;
