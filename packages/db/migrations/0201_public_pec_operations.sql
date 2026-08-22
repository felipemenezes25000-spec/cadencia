-- 0201_public_pec_operations.sql
-- Camada operacional para implantação do PEC em contratos públicos.
-- Não substitui homologações externas (RNDS/e-SUS APS); registra o estado real
-- de migrações, interoperabilidade, SLA e evidências de operação.

CREATE TYPE app.public_migration_status AS ENUM (
  'planejada','extraindo','validando','importando','reconciliando','concluida','falhou','cancelada'
);

CREATE TYPE app.public_interop_target AS ENUM ('rnds','esus_aps','siaps');
CREATE TYPE app.public_delivery_status AS ENUM (
  'pendente','enviando','aceito','rejeitado','retry','cancelado'
);

CREATE TABLE app.public_operation_profile (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  sla_mensal_percentual numeric(5,2) NOT NULL DEFAULT 99.90
    CHECK (sla_mensal_percentual BETWEEN 90 AND 100),
  rpo_minutos integer NOT NULL DEFAULT 15 CHECK (rpo_minutos BETWEEN 0 AND 1440),
  rto_minutos integer NOT NULL DEFAULT 240 CHECK (rto_minutos BETWEEN 1 AND 10080),
  retencao_prontuario_anos integer NOT NULL DEFAULT 20 CHECK (retencao_prontuario_anos BETWEEN 1 AND 100),
  residencia_dados_pais char(2) NOT NULL DEFAULT 'BR' CHECK (residencia_dados_pais ~ '^[A-Z]{2}$'),
  intervalo_teste_restore_dias integer NOT NULL DEFAULT 90 CHECK (intervalo_teste_restore_dias BETWEEN 1 AND 365),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
ALTER TABLE app.public_operation_profile OWNER TO app_owner;

CREATE TABLE app.public_migration_job (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (length(trim(source_system)) BETWEEN 2 AND 160),
  source_version text,
  source_kind text NOT NULL CHECK (source_kind IN ('database','api','csv','xml','json','fhir','other')),
  status app.public_migration_status NOT NULL DEFAULT 'planejada',
  source_snapshot_sha256 char(64)
    CHECK (source_snapshot_sha256 IS NULL OR source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  recebidos bigint NOT NULL DEFAULT 0 CHECK (recebidos >= 0),
  validos bigint NOT NULL DEFAULT 0 CHECK (validos >= 0),
  importados bigint NOT NULL DEFAULT 0 CHECK (importados >= 0),
  conciliados bigint NOT NULL DEFAULT 0 CHECK (conciliados >= 0),
  rejeitados bigint NOT NULL DEFAULT 0 CHECK (rejeitados >= 0),
  report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES id."user"(id),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz(3),
  completed_at timestamptz(3),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  CHECK (validos <= recebidos),
  CHECK (importados <= validos),
  CHECK (conciliados <= importados),
  CHECK (rejeitados <= recebidos),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX ix_public_migration_job_status
  ON app.public_migration_job(tenant_id, clinic_id, status, created_at DESC);
ALTER TABLE app.public_migration_job OWNER TO app_owner;

CREATE TABLE app.public_interop_delivery (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target app.public_interop_target NOT NULL,
  record_kind text NOT NULL CHECK (length(trim(record_kind)) BETWEEN 2 AND 120),
  source_ref text NOT NULL CHECK (length(trim(source_ref)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status app.public_delivery_status NOT NULL DEFAULT 'pendente',
  protocolo text,
  response_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000),
  last_error_code text,
  last_error_detail text CHECK (last_error_detail IS NULL OR length(last_error_detail) <= 2000),
  next_retry_at timestamptz(3),
  accepted_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id),
  UNIQUE (tenant_id, target, idempotency_key)
);
CREATE INDEX ix_public_interop_delivery_queue
  ON app.public_interop_delivery(tenant_id, clinic_id, target, status, next_retry_at, created_at);
ALTER TABLE app.public_interop_delivery OWNER TO app_owner;

CREATE TABLE app.public_operation_evidence (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'backup_restore','disaster_recovery','security_test','migration_reconciliation',
    'training','go_live','interoperability_homologation','availability_report','other'
  )),
  status text NOT NULL CHECK (status IN ('ok','warning','failed')),
  happened_at timestamptz(3) NOT NULL,
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 3 AND 1000),
  artifact_uri text CHECK (artifact_uri IS NULL OR length(artifact_uri) <= 1000),
  artifact_sha256 char(64)
    CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES id."user"(id),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, clinic_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id)
);
CREATE INDEX ix_public_operation_evidence_type
  ON app.public_operation_evidence(tenant_id, clinic_id, evidence_type, happened_at DESC);
ALTER TABLE app.public_operation_evidence OWNER TO app_owner;

GRANT SELECT, INSERT, UPDATE ON app.public_operation_profile TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.public_migration_job TO app_rw;
GRANT SELECT, INSERT, UPDATE ON app.public_interop_delivery TO app_rw;
GRANT SELECT, INSERT ON app.public_operation_evidence TO app_rw;

ALTER TABLE app.public_operation_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.public_operation_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.public_operation_profile AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.public_migration_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.public_migration_job FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.public_migration_job AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.public_interop_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.public_interop_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.public_interop_delivery AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.public_operation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.public_operation_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.public_operation_evidence AS PERMISSIVE FOR ALL TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
