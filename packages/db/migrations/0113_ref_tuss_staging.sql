-- 0113_ref_tuss_staging.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Infraestrutura de carga bimestral TUSS (Design §3.9). Duas tabelas GLOBAIS
-- (sem RLS, como ref.tuss_term): staging para validacao pre-swap e log de auditoria.

-- ============================================================
-- 1. Tabela de staging — mesmos campos de ref.tuss_term, sem EXCLUDE.
--    O job carrega aqui, valida, e entao faz o merge para tuss_term.
-- ============================================================
CREATE TABLE ref.tuss_staging (
  tabela      smallint NOT NULL,
  codigo      varchar(10) NOT NULL,
  termo       text NOT NULL,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,
  acao        text NOT NULL,
  PRIMARY KEY (tabela, codigo, vigencia)
);
ALTER TABLE ref.tuss_staging OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_staging IS 'global-reference';

-- ============================================================
-- 2. Log de carga — uma linha por execucao do job de carga.
--    Nao tem tenant_id, nao tem RLS: carga TUSS e operacao global da ANS.
-- ============================================================
CREATE TABLE ref.tuss_load_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competencia     char(6) NOT NULL,
  started_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at     timestamptz(3),
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'error')),
  terms_inserted  int NOT NULL DEFAULT 0,
  terms_updated   int NOT NULL DEFAULT 0,
  terms_unchanged int NOT NULL DEFAULT 0,
  staging_rows    int NOT NULL DEFAULT 0,
  error_message   text
);
ALTER TABLE ref.tuss_load_log OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_load_log IS 'global-reference';

-- ============================================================
-- 3. Privilegios
-- ============================================================
-- Staging: jobs carrega, valida e limpa.
GRANT SELECT, INSERT, DELETE, TRUNCATE ON ref.tuss_staging TO jobs;
-- Log: jobs grava, app_rw le (para exibir na tela de administracao).
GRANT SELECT, INSERT, UPDATE ON ref.tuss_load_log TO jobs;
GRANT SELECT ON ref.tuss_load_log TO app_rw;
