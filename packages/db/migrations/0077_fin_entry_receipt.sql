-- 0077_fin_entry_receipt.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Lancamento financeiro (fin.entry) e recibo (fin.receipt). Dinheiro em centavos
-- inteiros (bigint) — Money do kernel, nunca numeric. A coluna amount_cents e
-- bigint para acomodar valores grandes sem perda.

-- ---------------------------------------------------------------------------
-- 0. GRANTs faltantes da migration 0076 (fin.category, fin.payment_method)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON fin.category TO app_rw;
GRANT SELECT, INSERT, UPDATE ON fin.payment_method TO app_rw;

-- ---------------------------------------------------------------------------
-- 1. Lancamento financeiro
-- ---------------------------------------------------------------------------
CREATE TABLE fin.entry (
  tenant_id         uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                uuid NOT NULL,
  kind              fin.entry_kind NOT NULL,
  category_id       uuid,
  patient_id        uuid,
  appointment_id    uuid,
  professional_id   uuid NOT NULL,
  clinic_id         uuid NOT NULL,
  description       text NOT NULL COLLATE "pt-BR-x-icu",
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  payment_method_id uuid NOT NULL,
  paid_at           timestamptz(3),
  due_date          date,
  status            fin.entry_status NOT NULL DEFAULT 'pendente',
  external_ref      text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by        uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, category_id)
    REFERENCES fin.category(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)
    REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)
    REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES fin.payment_method(tenant_id, id)
);
ALTER TABLE fin.entry OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.entry TO app_rw;

CREATE INDEX ix_entry_tenant_clinic_date ON fin.entry
  (tenant_id, clinic_id, created_at DESC);
CREATE INDEX ix_entry_patient ON fin.entry (tenant_id, patient_id)
  WHERE patient_id IS NOT NULL;
CREATE INDEX ix_entry_appointment ON fin.entry (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

ALTER TABLE fin.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.entry AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Sequencia de recibo por tenant
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt_counter (
  tenant_id   uuid NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id)
);
ALTER TABLE fin.receipt_counter OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.receipt_counter TO app_rw;
ALTER TABLE fin.receipt_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt_counter AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Recibo
-- ---------------------------------------------------------------------------
CREATE TABLE fin.receipt (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  entry_id        uuid NOT NULL,
  receipt_number  bigint NOT NULL,
  issued_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  pdf_storage_key text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  FOREIGN KEY (tenant_id, entry_id)
    REFERENCES fin.entry(tenant_id, id)
);
ALTER TABLE fin.receipt OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON fin.receipt TO app_rw;
ALTER TABLE fin.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.receipt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.receipt AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 4. Whitelist de chaves de auditoria para financeiro
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
              'amount_cents',        -- valor em centavos do lancamento financeiro
              'payment_method',      -- tipo do meio de pagamento (enum fechado)
              'receipt_number'       -- numero sequencial do recibo
            )
         );
$$;

RESET ROLE;
