-- 0094_fin_statement_index.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Indice para extrato por conta e fluxo de caixa projetado. O alvo de latencia
-- do painel financeiro do mes e < 1 ms (~240 linhas, Apendice A).

-- ---------------------------------------------------------------------------
-- 1. Indice para extrato por conta: (bank_account_id, paid_at) com INCLUDE
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_bank_statement
  ON fin.entry (tenant_id, bank_account_id, paid_at)
  INCLUDE (kind, amount_cents, description, status, id)
  WHERE bank_account_id IS NOT NULL AND paid_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Indice para fluxo de caixa projetado: entries pendentes com due_date
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_projected_cashflow
  ON fin.entry (tenant_id, clinic_id, due_date)
  INCLUDE (kind, amount_cents, bank_account_id, status)
  WHERE status = 'pendente' AND due_date IS NOT NULL;
