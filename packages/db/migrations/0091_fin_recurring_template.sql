-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 3 · Bloco 02 — Template de lancamento recorrente.
-- O job de materializacao (packages/payments) gera fin.entry a partir de
-- templates com next_due_date <= hoje + 30 dias. Roda como `jobs` (BYPASSRLS).

-- ---------------------------------------------------------------------------
-- 1. Tipo enumerado de frequencia
-- ---------------------------------------------------------------------------
CREATE TYPE fin.recurrence_frequency AS ENUM (
  'weekly', 'biweekly', 'monthly', 'yearly'
);

-- ---------------------------------------------------------------------------
-- 2. Template de lancamento recorrente
-- ---------------------------------------------------------------------------
CREATE TABLE fin.recurring_template (
  tenant_id      uuid                    NOT NULL DEFAULT app.require_tenant_id(),
  id             uuid                    NOT NULL,
  description    text                    NOT NULL COLLATE "pt-BR-x-icu",
  kind           fin.entry_kind          NOT NULL,
  category_id    uuid,
  amount_cents   bigint                  NOT NULL CHECK (amount_cents > 0),
  clinic_id      uuid                    NOT NULL,
  bank_account_id uuid,
  cost_center_id  uuid,
  supplier_id    uuid,
  frequency      fin.recurrence_frequency NOT NULL,
  day_of_month   int                     CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  next_due_date  date                    NOT NULL,
  active         boolean                 NOT NULL DEFAULT true,
  ends_at        date,
  created_at     timestamptz(3)          NOT NULL DEFAULT clock_timestamp(),
  created_by     uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id)
    REFERENCES fin.category(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES fin.supplier(tenant_id, id),
  FOREIGN KEY (tenant_id, bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, cost_center_id)
    REFERENCES fin.cost_center(tenant_id, id)
);
ALTER TABLE fin.recurring_template OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.recurring_template TO app_rw;

ALTER TABLE fin.recurring_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.recurring_template FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.recurring_template AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE INDEX ix_recurring_active_due ON fin.recurring_template
  (tenant_id, next_due_date)
  WHERE active;

-- ---------------------------------------------------------------------------
-- 3. GRANT para jobs — o job de materializacao roda como BYPASSRLS
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE ON fin.recurring_template TO jobs;

-- ---------------------------------------------------------------------------
-- 4. Coluna recurring_template_id em fin.entry (nullable — entries manuais
--    nao vem de template). Permite rastrear a origem.
-- ---------------------------------------------------------------------------
ALTER TABLE fin.entry ADD COLUMN recurring_template_id uuid;

ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_recurring_template
    FOREIGN KEY (tenant_id, recurring_template_id)
    REFERENCES fin.recurring_template(tenant_id, id);

CREATE INDEX ix_entry_recurring ON fin.entry (tenant_id, recurring_template_id)
  WHERE recurring_template_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Whitelist de chaves de auditoria para recorrentes e parcelamento
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name'
            )
         );
$$;

RESET ROLE;
