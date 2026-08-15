-- 0189_calendar_sync_secure_functions.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- 0188 abriu GRANTs diretos para viabilizar o worker. Esta migration reduz a
-- superficie: jobs nao precisa editar conexao nem ler agenda arbitrariamente;
-- precisa apenas das tres operacoes abaixo, com parametros e colunas fechados.

BEGIN;

REVOKE SELECT, UPDATE ON app.calendar_sync FROM jobs;
REVOKE SELECT ON sched.appointment FROM jobs;
REVOKE SELECT ON sched.procedure FROM jobs;

CREATE OR REPLACE FUNCTION app.calendar_sync_candidates(
  p_tenant_id uuid,
  p_user_id uuid,
  p_force boolean
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  provider text,
  access_token_enc bytea,
  external_id text,
  last_sync_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $$
  SELECT c.id, c.tenant_id, c.user_id, c.provider,
         c.access_token_enc, c.external_id, c.last_sync_at
    FROM app.calendar_sync c
   WHERE c.enabled = true
     AND c.provider = 'google'
     AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
     AND (p_user_id IS NULL OR c.user_id = p_user_id)
     AND (p_force = true
       OR c.last_sync_at IS NULL
       OR c.last_sync_at < clock_timestamp() - interval '14 minutes')
   ORDER BY c.tenant_id, c.user_id, c.id;
$$;
ALTER FUNCTION app.calendar_sync_candidates(uuid, uuid, boolean) OWNER TO app_owner;
REVOKE ALL ON FUNCTION app.calendar_sync_candidates(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendar_sync_candidates(uuid, uuid, boolean) TO jobs;

CREATE OR REPLACE FUNCTION app.calendar_sync_appointments(
  p_tenant_id uuid,
  p_user_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  patient_name text,
  clinic_name text,
  procedure_name text,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $$
  SELECT a.id, a.starts_at, a.ends_at, a.status::text,
         pat.display_name AS patient_name,
         cl.nome AS clinic_name,
         pr.nome AS procedure_name,
         a.updated_at
    FROM sched.appointment a
    JOIN app.professional prof
      ON prof.tenant_id = a.tenant_id AND prof.id = a.professional_id
    JOIN clin.patient pat
      ON pat.tenant_id = a.tenant_id AND pat.id = a.patient_id
    JOIN app.clinic cl
      ON cl.tenant_id = a.tenant_id AND cl.id = a.clinic_id
    LEFT JOIN sched.procedure pr
      ON pr.tenant_id = a.tenant_id AND pr.id = a.procedure_id
   WHERE a.tenant_id = p_tenant_id
     AND prof.user_id = p_user_id
     AND a.starts_at >= clock_timestamp() - interval '7 days'
     AND a.starts_at < clock_timestamp() + interval '365 days'
     AND (p_since IS NULL OR a.updated_at >= p_since)
   ORDER BY a.updated_at, a.id;
$$;
ALTER FUNCTION app.calendar_sync_appointments(uuid, uuid, timestamptz) OWNER TO app_owner;
REVOKE ALL ON FUNCTION app.calendar_sync_appointments(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendar_sync_appointments(uuid, uuid, timestamptz) TO jobs;

CREATE OR REPLACE FUNCTION app.calendar_sync_mark_success(p_connection_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog
AS $$
  UPDATE app.calendar_sync
     SET last_sync_at = clock_timestamp()
   WHERE id = p_connection_id
     AND enabled = true
     AND provider = 'google';
$$;
ALTER FUNCTION app.calendar_sync_mark_success(uuid) OWNER TO app_owner;
REVOKE ALL ON FUNCTION app.calendar_sync_mark_success(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendar_sync_mark_success(uuid) TO jobs;

COMMIT;
