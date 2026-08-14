-- 0178_teleconsulta.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- Fase 8 - Teleconsulta: sala de video (Jitsi) atrelada ao agendamento.
-- O adaptador gera room_id/room_url no momento da criacao (ver
-- packages/integrations/src/adapters/jitsi-teleconsult.ts); esta tabela so
-- registra o que foi gerado e o ciclo de vida da sala (started_at/ended_at).
--
-- appointment_id referencia sched.appointment (nao clin.appointment, que nao
-- existe) — FK composta com tenant_id, mesmo padrao de msg.nps_response (0074),
-- para que uma teleconsulta nunca aponte para agendamento de outro tenant.

CREATE TABLE clin.teleconsulta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id        uuid NOT NULL,
  appointment_id   uuid NOT NULL,
  provider         text NOT NULL DEFAULT 'jitsi',
  room_id          text NOT NULL,
  room_url         text NOT NULL,
  started_at       timestamptz(3),
  ended_at         timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_teleconsulta_tenant
    FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, clinic_id)      REFERENCES app.clinic(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES sched.appointment(tenant_id, id)
);
ALTER TABLE clin.teleconsulta OWNER TO app_owner;

CREATE INDEX ix_teleconsulta_appointment
  ON clin.teleconsulta (tenant_id, appointment_id);

GRANT SELECT, INSERT, UPDATE ON clin.teleconsulta TO app_rw;

ALTER TABLE clin.teleconsulta ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.teleconsulta FORCE  ROW LEVEL SECURITY;
CREATE POLICY teleconsulta_tenant ON clin.teleconsulta AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- audit.meta_keys_ok: acrescenta room_id e room_provider (novas — chaves
-- gravadas por apps/api/src/routes/teleconsultas.ts via audit.log). Nao e
-- `provider`: `provedor` ja existe na lista para integracao em geral, e
-- `room_provider` evita colisao de sentido mantendo o nome que a rota usa.
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
