-- LGPD compliance: consent management + data portability requests
--
-- Art. 7 LGPD: bases legais de tratamento. Em saude, o tratamento de dados
-- pessoais de pacientes tem base na "tutela da saude" (art. 7, VIII) e no
-- "cumprimento de obrigacao legal" (art. 7, II — prontuario medico por 20 anos,
-- CFM 1821/2007). Consentimento explicito LGPD e exigido para:
--   - comunicacoes de marketing
--   - compartilhamento com terceiros (pesquisa, laboratorios parceiros)
--   - uso de dados para IA/analytics alem do estritamente assistencial
--
-- Art. 18: direitos do titular — portabilidade, acesso, correcao, eliminacao
-- (limitada em saude pelo dever de guarda).

BEGIN;

CREATE TYPE app.lgpd_consent_purpose AS ENUM (
  'marketing',
  'pesquisa',
  'compartilhamento_terceiros',
  'ia_analytics'
);

CREATE TYPE app.lgpd_request_type AS ENUM (
  'portabilidade',
  'acesso',
  'eliminacao'
);

CREATE TYPE app.lgpd_request_status AS ENUM (
  'pendente',
  'em_andamento',
  'concluido',
  'recusado'
);

CREATE TABLE app.lgpd_consent (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES app.tenant(id),
  patient_id      uuid        NOT NULL REFERENCES clin.patient(id),
  purpose         app.lgpd_consent_purpose NOT NULL,
  granted         boolean     NOT NULL DEFAULT false,
  granted_at      timestamptz,
  revoked_at      timestamptz,
  collected_by    uuid        REFERENCES id."user"(id),
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX lgpd_consent_unique_active
  ON app.lgpd_consent (tenant_id, patient_id, purpose)
  WHERE revoked_at IS NULL;

ALTER TABLE app.lgpd_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_consent_tenant ON app.lgpd_consent
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON app.lgpd_consent TO app_rw;

CREATE TABLE app.lgpd_data_request (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES app.tenant(id),
  patient_id      uuid        NOT NULL REFERENCES clin.patient(id),
  request_type    app.lgpd_request_type NOT NULL,
  status          app.lgpd_request_status NOT NULL DEFAULT 'pendente',
  requested_by    uuid        NOT NULL REFERENCES id."user"(id),
  processed_by    uuid        REFERENCES id."user"(id),
  justification   text,
  response_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '15 days',
  PRIMARY KEY (id)
);

ALTER TABLE app.lgpd_data_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_data_request_tenant ON app.lgpd_data_request
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON app.lgpd_data_request TO app_rw;

-- Audit keys for LGPD events
INSERT INTO audit.event_meta (key, label_pt) VALUES
  ('LGPD_CONSENT_GRANTED',   'Consentimento LGPD concedido'),
  ('LGPD_CONSENT_REVOKED',   'Consentimento LGPD revogado'),
  ('LGPD_DATA_REQUEST',      'Solicitacao de direito LGPD'),
  ('LGPD_DATA_REQUEST_DONE', 'Solicitacao LGPD concluida')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- audit.meta_keys_ok: acrescenta patient_id, purpose, request_type, new_status
-- (chaves gravadas por apps/api/src/routes/lgpd.ts via audit.log).
-- patient_id: UUID do paciente titular do consentimento/solicitacao.
-- purpose: enum lgpd_consent_purpose — marketing, pesquisa etc.
-- request_type: enum lgpd_request_type — portabilidade, acesso, eliminacao.
-- new_status: enum lgpd_request_status — transicao ao processar solicitacao.
-- Nenhuma carrega dado clinico.
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

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
              'room_provider',
              'patient_id',
              'purpose',
              'request_type',
              'new_status'
            )
         );
$fn$;

RESET ROLE;

COMMIT;
