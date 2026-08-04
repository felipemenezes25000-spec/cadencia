-- 0013_audit_log_security.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Canal B: seguranca e acesso. Recebe tenant e ator EXPLICITAMENTE, porque o
-- evento tipico deste canal e justamente aquele em que o contexto esta ausente
-- ou e invalido. Chamado por um pool dedicado, fora da transacao de negocio.

SET ROLE audit_owner;

CREATE FUNCTION audit.log_security(
  p_event_type    text,
  p_outcome       text,
  p_entity_schema text,
  p_entity_table  text,
  p_entity_id     uuid  DEFAULT NULL,
  p_tenant_id     uuid  DEFAULT NULL,
  p_clinic_id     uuid  DEFAULT NULL,
  p_actor_user_id uuid  DEFAULT NULL,
  p_actor_kind    text  DEFAULT 'anon',
  p_session_id    uuid  DEFAULT NULL,
  p_request_id    uuid  DEFAULT NULL,
  p_ip            inet  DEFAULT NULL,
  p_meta          jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, pg_catalog AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      ip, session_id, request_id, meta)
  VALUES (
      p_tenant_id, p_clinic_id, p_actor_user_id, p_actor_kind, p_event_type,
      p_entity_schema, p_entity_table, p_entity_id, p_outcome,
      p_ip, p_session_id, p_request_id, p_meta);

  -- Sem RETURNING, pela mesma razao ja documentada na 0012: com FORCE RLS um
  -- `INSERT ... RETURNING` aplica tambem as policies de SELECT a linha devolvida,
  -- e audit_owner nao tem nenhuma (a unica de leitura, tenant_read da 0010, e
  -- TO app_rw). Com RETURNING esta funcao falharia em TODA chamada com
  -- "new row violates row-level security policy" — verificado no banco local.
  -- currval devolve o id recem-gerado nesta mesma sessao sem tocar na linha.
  v_id := currval(pg_get_serial_sequence('audit.event', 'id'));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) TO app_rw;

RESET ROLE;
