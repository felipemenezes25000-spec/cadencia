-- 0170_billing_invoices.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- Schema `com` (comercial): faturas de cobranca.
-- Armazena history de cobrancas do tenant.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fatura
-- ---------------------------------------------------------------------------
CREATE TABLE com.fatura (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenant(id),
  assinatura_id       uuid REFERENCES com.assinatura(id),
  valor_cents         int NOT NULL CHECK (valor_cents >= 0),
  status              text NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','paga','vencida','cancelada')),
  data_vencimento     date NOT NULL,
  data_pagamento      date,
  link_pagamento      text,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE com.fatura OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.fatura TO app_rw;

-- Index para jobs que buscam faturas pendentes
CREATE INDEX ix_fatura_status ON com.fatura (status)
  WHERE status IN ('pendente', 'vencida');

-- Index para jobs que vencem hoje
CREATE INDEX ix_fatura_vencimento ON com.fatura (data_vencimento, status)
  WHERE status = 'pendente';

-- Index para listar faturas de um tenant
CREATE INDEX ix_fatura_tenant ON com.fatura (tenant_id, data_vencimento DESC);

COMMIT;
