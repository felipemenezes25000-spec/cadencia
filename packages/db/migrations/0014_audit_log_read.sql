-- 0014_audit_log_read.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Auditoria de leitura clinica, deduplicada por (usuario, paciente, caso de uso)
-- em janela de 5 minutos. Sem isso, a lista virtualizada de 50 pacientes gera
-- 50 INSERTs por scroll e a trilha cresce mais rapido que o dominio.
-- A deduplicacao vive no banco: dois processos api nao compartilham cache.

SET ROLE audit_owner;

CREATE TABLE audit.read_dedup (
  tenant_id      uuid NOT NULL,
  actor_user_id  uuid NOT NULL,
  entity_id      uuid NOT NULL,          -- patient_id: REFERENCIA, nunca CPF/CNS/nome
  use_case       text NOT NULL,
  last_logged_at timestamptz(3) NOT NULL,
  PRIMARY KEY (tenant_id, actor_user_id, entity_id, use_case));

ALTER TABLE audit.read_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.read_dedup FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_all ON audit.read_dedup AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);
REVOKE ALL ON audit.read_dedup FROM PUBLIC, app_rw, app_owner;

CREATE FUNCTION audit.log_read(
  p_use_case      text,
  p_patient_id    uuid,
  p_tenant_id     uuid DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_clinic_id     uuid DEFAULT NULL,
  p_session_id    uuid DEFAULT NULL,
  p_request_id    uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, app, pg_catalog AS $$
DECLARE
  -- Aceita os valores explicitos (pool dedicado do canal B) e cai para o GUC
  -- quando chamada de dentro de clin.read_encounter()/clin.read_patient_record().
  v_tenant uuid    := coalesce(p_tenant_id,     app.current_tenant_id());
  v_user   uuid    := coalesce(p_actor_user_id, app.current_user_id());
  v_nova   boolean;
  v_id     bigint;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    -- Leitura sem contexto nao e deduplicavel: e tentativa, e vira evento
    -- de negacao sempre, sem janela.
    INSERT INTO audit.event (
        tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
        entity_schema, entity_table, entity_id, outcome,
        session_id, request_id, meta)
    VALUES (
        v_tenant, p_clinic_id, v_user, 'anon', 'PATIENT_RECORD_READ',
        'clin', 'patient', p_patient_id, 'negado',
        p_session_id, p_request_id, jsonb_build_object('use_case', p_use_case));

    -- Sem RETURNING, pela mesma razao ja documentada na 0012 e na 0013: com
    -- FORCE RLS um `INSERT ... RETURNING` aplica tambem as policies de SELECT
    -- a linha devolvida, e audit_owner nao tem nenhuma (a unica de leitura,
    -- tenant_read da 0010, e TO app_rw). Verificado no banco local: o
    -- RETURNING falha com "new row violates row-level security policy".
    v_id := currval(pg_get_serial_sequence('audit.event', 'id'));
    RETURN v_id;
  END IF;

  -- Atomico entre processos: se a marca ainda esta dentro da janela, o
  -- DO UPDATE nao acontece e o RETURNING nao devolve linha.
  INSERT INTO audit.read_dedup AS d
         (tenant_id, actor_user_id, entity_id, use_case, last_logged_at)
  VALUES (v_tenant, v_user, p_patient_id, p_use_case, clock_timestamp())
  ON CONFLICT (tenant_id, actor_user_id, entity_id, use_case) DO UPDATE
     SET last_logged_at = clock_timestamp()
   WHERE d.last_logged_at < clock_timestamp() - interval '5 minutes'
  RETURNING true INTO v_nova;

  IF v_nova IS NULL THEN
    RETURN NULL;                 -- dentro da janela: nada a registrar
  END IF;

  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      session_id, request_id, meta)
  VALUES (
      v_tenant, p_clinic_id, v_user, 'user', 'PATIENT_RECORD_READ',
      'clin', 'patient', p_patient_id, 'sucesso',
      p_session_id, p_request_id, jsonb_build_object('use_case', p_use_case));

  v_id := currval(pg_get_serial_sequence('audit.event', 'id'));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log_read(text,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log_read(text,uuid,uuid,uuid,uuid,uuid,uuid)
  TO app_rw, clin_writer;

RESET ROLE;
