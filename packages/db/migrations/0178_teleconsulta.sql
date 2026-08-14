-- Migration 0178: teleconsulta — tabela + RLS + audit meta keys

CREATE TABLE clin.teleconsulta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  clinic_id        uuid NOT NULL,
  appointment_id   uuid NOT NULL REFERENCES clin.appointment(id),
  provider         text NOT NULL DEFAULT 'jitsi',
  room_id          text NOT NULL,
  room_url         text NOT NULL,
  started_at       timestamptz(3),
  ended_at         timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_teleconsulta_tenant FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);

ALTER TABLE clin.teleconsulta ENABLE ROW LEVEL SECURITY;

CREATE POLICY teleconsulta_tenant ON clin.teleconsulta
  USING (tenant_id = app.require_tenant_id());

CREATE INDEX idx_teleconsulta_appointment ON clin.teleconsulta (appointment_id);

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
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
              'transfer_id',
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku',
              'numero_guia',
              'operadora_nome',
              'registro_ans',
              'guia_status',
              'guia_count',
              'numero_lote',
              'item_count',
              'total_recursado_cents',
              'total_resultados',
              'deferidos',
              'valores_expurgados',
              'anexos_expurgados',
              'corte_retencao',
              'ocorrencias',
              'target_user_id',
              'membership_id',
              'clinic_id',
              'antigo_role',
              'dataset',
              'format',
              'field',
              'old_value',
              'new_value',
              'room_id',
              'room_provider'
            )
         );
$fn$;
