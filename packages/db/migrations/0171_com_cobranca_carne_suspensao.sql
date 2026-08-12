-- 0171_com_cobranca_carne_suspensao.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Schema `com` (comercial): cobranca, carne e suspensao.
-- Extende o billing com documento de cobranca, carnes de pagamento e controle
-- de suspensao por inadimplencia.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Patch: adicionar UNIQUE (tenant_id, id) em com.assinatura e com.fatura
--    necessario para FK compostas (tenant_id, id) referencing (tenant_id, id)
-- ---------------------------------------------------------------------------
ALTER TABLE com.assinatura ADD CONSTRAINT assinatura_tenant_id_id_uniq UNIQUE (tenant_id, id);
ALTER TABLE com.fatura    ADD CONSTRAINT fatura_tenant_id_id_uniq    UNIQUE (tenant_id, id);

-- ---------------------------------------------------------------------------
-- 1. Grants faltantes da 0165 e 0170
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON com.fatura TO app_rw;

-- ---------------------------------------------------------------------------
-- 1. Cobranca — documento de cobranca vinculado a uma ou mais faturas
-- ---------------------------------------------------------------------------
CREATE TABLE com.cobranca (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  assinatura_id   uuid NOT NULL REFERENCES com.assinatura(id),
  fatura_id       uuid NOT NULL REFERENCES com.fatura(id),
 NossoNumero     text,
  status          text NOT NULL DEFAULT 'aberta'
                    CHECK (status IN ('aberta','enviada','liquidada','cancelada','protestada')),
  valor_original_cents int NOT NULL CHECK (valor_original_cents >= 0),
  valor_juros_cents    int NOT NULL DEFAULT 0 CHECK (valor_juros_cents >= 0),
  valor_multa_cents   int NOT NULL DEFAULT 0 CHECK (valor_multa_cents >= 0),
  valor_desconto_cents int NOT NULL DEFAULT 0 CHECK (valor_desconto_cents >= 0),
  data_vencimento     date NOT NULL,
  data_liquidacao      date,
  link_boleto          text,
  codigo_barras         text,
  instrucoes_banco      text,
  created_at           timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, fatura_id),
  FOREIGN KEY (tenant_id, assinatura_id)
    REFERENCES com.assinatura(tenant_id, id),
  FOREIGN KEY (tenant_id, fatura_id)
    REFERENCES com.fatura(tenant_id, id)
);
ALTER TABLE com.cobranca OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.cobranca TO app_rw;

CREATE INDEX ix_cobranca_status ON com.cobranca (status)
  WHERE status IN ('aberta', 'enviada');
CREATE INDEX ix_cobranca_vencimento ON com.cobranca (data_vencimento, status)
  WHERE status IN ('aberta', 'enviada');
CREATE INDEX ix_cobranca_tenant ON com.cobranca (tenant_id, created_at DESC);

ALTER TABLE com.cobranca ENABLE ROW LEVEL SECURITY;
CREATE POLICY cobranca_isolation ON com.cobranca AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Carne — carnê de pagamento (parcelas do documento de cobranca)
-- ---------------------------------------------------------------------------
CREATE TABLE com.carne (
  tenant_id           uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                  uuid NOT NULL,
  cobranca_id         uuid NOT NULL,
  numero_parcela       int NOT NULL CHECK (numero_parcela >= 1),
  valor_parcela_cents  int NOT NULL CHECK (valor_parcela_cents >= 0),
  data_vencimento      date NOT NULL,
  data_pagamento       date,
  status               text NOT NULL DEFAULT 'aberta'
                       CHECK (status IN ('aberta','paga','vencida','cancelada')),
  NossoNumero          text,
  link_boleto          text,
  codigo_barras        text,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cobranca_id, numero_parcela),
  FOREIGN KEY (tenant_id, cobranca_id)
    REFERENCES com.cobranca(tenant_id, id)
);
ALTER TABLE com.carne OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.carne TO app_rw;

CREATE INDEX ix_carne_status ON com.carne (status)
  WHERE status IN ('aberta', 'vencida');
CREATE INDEX ix_carne_vencimento ON com.carne (data_vencimento, status)
  WHERE status = 'aberta';
CREATE INDEX ix_carne_cobranca ON com.carne (tenant_id, cobranca_id);

ALTER TABLE com.carne ENABLE ROW LEVEL SECURITY;
CREATE POLICY carne_isolation ON com.carne AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Suspensao — controle de suspensao por inadimplencia
-- ---------------------------------------------------------------------------
CREATE TABLE com.suspensao (
  tenant_id         uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                uuid NOT NULL,
  assinatura_id     uuid NOT NULL REFERENCES com.assinatura(id),
  cobranca_id       uuid REFERENCES com.cobranca(id),
  motivo            text NOT NULL CHECK (motivo IN ('inadimplencia','nao_pagamento','outro')),
  motivo_detalhe    text,
  data_inicio       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  data_fim          timestamptz(3),
  restaurada_em     timestamptz(3),
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by        uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assinatura_id)
    REFERENCES com.assinatura(tenant_id, id),
  FOREIGN KEY (tenant_id, cobranca_id)
    REFERENCES com.cobranca(tenant_id, id)
);
ALTER TABLE com.suspensao OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.suspensao TO app_rw;

CREATE INDEX ix_suspensao_ativa ON com.suspensao (tenant_id)
  WHERE data_fim IS NULL;
CREATE INDEX ix_suspensao_assinatura ON com.suspensao (tenant_id, assinatura_id);

ALTER TABLE com.suspensao ENABLE ROW LEVEL SECURITY;
CREATE POLICY suspensao_isolation ON com.suspensao AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Grants para jobs
-- ---------------------------------------------------------------------------
GRANT SELECT ON com.cobranca  TO jobs;
GRANT SELECT ON com.carne     TO jobs;
GRANT SELECT ON com.suspensao TO jobs;

COMMIT;
