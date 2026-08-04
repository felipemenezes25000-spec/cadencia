-- 0009_audit_schema_event.sql
-- Trilha de auditoria (NGS1.07). O schema pertence a audit_owner: nem app_owner
-- (dono das migrations) nem app_rw (papel funcional da aplicacao) escrevem nele.
-- Em producao a migration roda como app_owner, que e membro de audit_owner (0001).

CREATE SCHEMA audit AUTHORIZATION audit_owner;

SET ROLE audit_owner;

-- NGS1.07.06: a trilha registra QUE algo aconteceu, nunca O QUE foi escrito.
-- 'meta' aceita apenas chaves desta whitelist. Chave nova exige migration
-- revisada; e isso que impede um `meta: { queixa: ... }` de virar vazamento.
CREATE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',      -- motivo de negacao, de quebra-vidro, de expurgo
              'route',       -- rota HTTP, sem query string
              'method',      -- verbo HTTP
              'status_code',
              'duration_ms',
              'use_case',    -- caso de uso de leitura (deduplicacao, §3.7)
              'record_count',
              'version_no',
              'kind',        -- original | retificacao | adendo | ...
              'role',
              'grant_id',    -- concessao de break-glass
              'ticket',      -- chamado do suporte
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id'
            )
         );
$$;

CREATE TABLE audit.event (
  id bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  tenant_id uuid,                      -- NULLABLE: tentativa sem contexto tambem e evento
  clinic_id uuid,                      -- carimbado NO EVENTO, nao na hora de exportar
  actor_user_id uuid, actor_kind text NOT NULL,
  event_type text NOT NULL,
  entity_schema text NOT NULL, entity_table text NOT NULL,
  entity_id uuid,                      -- REFERENCIA, nunca conteudo (NGS1.07.06)
  outcome text NOT NULL CHECK (outcome IN ('sucesso','negado','erro')),
  ip inet, session_id uuid, request_id uuid, user_agent_hash bytea,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT meta_sem_pii CHECK (audit.meta_keys_ok(meta))   -- whitelist de chaves
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ix_audit_tenant ON audit.event (tenant_id, occurred_at DESC, id);

-- Particoes mensais. Sem particao o INSERT falha com
-- "no partition of relation \"event\" found for row".
DO $$
DECLARE
  v_from date;
  v_to   date;
  v_name text;
BEGIN
  FOR i IN 0..5 LOOP
    v_from := (date_trunc('month', now()) + (i || ' month')::interval)::date;
    v_to   := (v_from + interval '1 month')::date;
    v_name := 'event_' || to_char(v_from, 'YYYYMM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS audit.%I PARTITION OF audit.event
         FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
  END LOOP;
END $$;

RESET ROLE;
