-- 0004_tenant_clinic.sql
-- Fase 0 · design §3.3 — a raiz do isolamento.
-- Schemas, extensoes e GRANT USAGE ja vieram na 0002.
-- RLS, policies e GRANTs de linha entram mais adiante. Aqui e so estrutura.

CREATE TABLE app.tenant (
  id uuid PRIMARY KEY, slug citext NOT NULL UNIQUE, razao_social text NOT NULL,
  -- IN RFB 2.229/2024 (desde 01/07/2026): CNPJ e ALFANUMERICO.
  cnpj varchar(14) NOT NULL CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  -- Lei 13.787/2018 art.6 §5: 20 anos e MINIMO. NULL = indefinido. Jamais hard-code 20.
  retencao_anos smallint CHECK (retencao_anos IS NULL OR retencao_anos >= 20),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp());
ALTER TABLE app.tenant OWNER TO app_owner;

-- app.tenant e a UNICA tabela de app/clin/fin/tiss/audit sem coluna tenant_id:
-- o proprio id E o tenant. A excecao e declarada aqui, em migration revisada,
-- e nao num Set editavel dentro de arquivo de teste (§3.13 item 1).
COMMENT ON TABLE app.tenant IS 'tenant-root';

CREATE TABLE app.clinic (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL, nome text NOT NULL,
  cnpj varchar(14) CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes char(7) CHECK (cnes ~ '^[0-9]{7}$'),   -- SEM DEFAULT: dado falso vira lote glosado.
  -- Fuso e da UNIDADE, nao do tenant: rede SP+Manaus e caso real.
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  PRIMARY KEY (id), UNIQUE (tenant_id, id));
ALTER TABLE app.clinic OWNER TO app_owner;

CREATE INDEX ix_clinic_tenant ON app.clinic (tenant_id);
