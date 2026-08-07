-- 0110_tiss_operadora.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 Fase 4: operadora de plano de saude por tenant.
-- Registro ANS e char(6) com CHECK de 6 digitos. CNPJ alfanumerico (IN RFB 2.229/2024).
-- Nenhuma ocorrencia de now() ou current_date no schema tiss — invariante de CI.

CREATE TABLE tiss.operadora (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  registro_ans    char(6) NOT NULL CHECK (registro_ans ~ '^[0-9]{6}$'),
  razao_social    text NOT NULL COLLATE "pt-BR-x-icu",
  nome_fantasia   text COLLATE "pt-BR-x-icu",
  cnpj            varchar(14) NOT NULL
    CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  telefone        text,
  email           text,
  portal_url      text,
  portal_login    text,
  portal_obs      text,
  tiss_version    varchar(5) NOT NULL DEFAULT '3.05',
  transport_mode  text NOT NULL DEFAULT 'arquivo'
    CHECK (transport_mode IN ('arquivo','webservice')),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by      uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, registro_ans),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);
ALTER TABLE tiss.operadora OWNER TO app_owner;

CREATE INDEX ix_operadora_nome
  ON tiss.operadora (tenant_id, razao_social COLLATE "pt-BR-x-icu")
  WHERE active;

GRANT SELECT, INSERT, UPDATE ON tiss.operadora TO app_rw;
GRANT SELECT ON tiss.operadora TO jobs;

ALTER TABLE tiss.operadora ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.operadora FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.operadora AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_read ON tiss.operadora AS PERMISSIVE FOR SELECT TO jobs
  USING (true);
