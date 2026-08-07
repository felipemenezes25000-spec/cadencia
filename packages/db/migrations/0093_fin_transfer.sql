-- 0093_fin_transfer.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- [RECONCILIADO] fin.bank_account e bank_account_id em fin.entry ja existem
-- desde as migrations 0086 e 0087 (Bloco 01). Esta migration so cria
-- fin.transfer e atualiza audit.meta_keys_ok com as chaves de transferencia.

-- ---------------------------------------------------------------------------
-- 1. Tabela de transferencia entre contas
-- ---------------------------------------------------------------------------
CREATE TABLE fin.transfer (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                    uuid NOT NULL,
  from_bank_account_id  uuid NOT NULL,
  to_bank_account_id    uuid NOT NULL,
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  transferred_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  description           text NOT NULL COLLATE "pt-BR-x-icu",
  debit_entry_id        uuid NOT NULL,
  credit_entry_id       uuid NOT NULL,
  created_by            uuid,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, from_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, to_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, debit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  FOREIGN KEY (tenant_id, credit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  CHECK (from_bank_account_id <> to_bank_account_id)
);
ALTER TABLE fin.transfer OWNER TO app_owner;
GRANT SELECT, INSERT ON fin.transfer TO app_rw;

ALTER TABLE fin.transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.transfer FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.transfer AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Whitelist de chaves de auditoria — MERGE de Bloco 02 (0091) + transferencia
-- [RECONCILIADO] Esta versao inclui TODAS as chaves de 0091 (recorrencia/
-- parcelamento/fornecedor) mais as novas de transferencia. Como e CREATE OR
-- REPLACE, a ultima migration a rodar (0093) prevalece — por isso deve ter
-- a uniao de tudo.
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
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id'
            )
         );
$$;

RESET ROLE;
