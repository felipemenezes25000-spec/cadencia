-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Plano de parcelamento.
-- A parcela-mae e uma fin.entry existente. As parcelas filhas sao outras
-- fin.entry com installment_plan_id apontando para o plano.

-- ---------------------------------------------------------------------------
-- 1. Tabela de plano de parcelamento
-- ---------------------------------------------------------------------------
CREATE TABLE fin.installment_plan (
  tenant_id              uuid    NOT NULL DEFAULT app.require_tenant_id(),
  id                     uuid    NOT NULL,
  mother_entry_id        uuid    NOT NULL,
  total_installments     int     NOT NULL CHECK (total_installments >= 2),
  generated_installments int     NOT NULL DEFAULT 0 CHECK (generated_installments >= 0),
  created_at             timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, mother_entry_id),
  FOREIGN KEY (tenant_id, mother_entry_id)
    REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.installment_plan OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.installment_plan TO app_rw;

ALTER TABLE fin.installment_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.installment_plan FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.installment_plan AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. FK de parcela filha → plano (nullable — entries avulsas nao tem plano)
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN installment_plan_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_installment_plan
    FOREIGN KEY (tenant_id, installment_plan_id)
    REFERENCES fin.installment_plan(tenant_id, id);

CREATE INDEX ix_entry_installment_plan ON fin.entry (tenant_id, installment_plan_id)
  WHERE installment_plan_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON fin.installment_plan TO jobs;
