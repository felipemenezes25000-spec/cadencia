-- 0087_fin_entry_bank_account_cost_center.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Expande fin.entry com as dimensoes de conta bancaria e centro de custo.
-- Ambas NULLABLE: lancamentos da Fase 2 continuam validos sem conta ou centro.
-- FK composta (tenant_id, *_id) conforme regra §3.4.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Coluna bank_account_id — NULLABLE, FK composta
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry
  ADD COLUMN bank_account_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_bank_account
    FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id);

CREATE INDEX ix_entry_bank_account ON fin.entry (tenant_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Coluna cost_center_id — NULLABLE, FK composta
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry
  ADD COLUMN cost_center_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_cost_center
    FOREIGN KEY (tenant_id, cost_center_id)
    REFERENCES fin.cost_center(tenant_id, id);

CREATE INDEX ix_entry_cost_center ON fin.entry (tenant_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

COMMIT;
