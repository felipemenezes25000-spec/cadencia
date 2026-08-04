-- 0012_audit_log.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Canal A: evento de dominio, DENTRO da transacao de negocio.
-- SECURITY DEFINER porque roda como audit_owner e so assim casa com a
-- policy `writer` da 0010. A aplicacao recebe EXECUTE; nunca INSERT.

SET ROLE audit_owner;

-- clin_writer e o papel das funcoes SECURITY DEFINER do nucleo clinico
-- (clin.finalize_encounter), que chamam audit.log. A 0010 concedeu USAGE no
-- schema audit apenas a app_rw. Sem esta linha o EXECUTE abaixo e inutil:
-- a finalizacao de atendimento falha com 42501 "permission denied for schema
-- audit" no primeiro deploy, e nenhum atendimento pode ser finalizado.
GRANT USAGE ON SCHEMA audit TO clin_writer;

CREATE FUNCTION audit.log(
  p_event_type    text,
  p_entity_schema text,
  p_entity_table  text,
  p_entity_id     uuid  DEFAULT NULL,
  p_outcome       text  DEFAULT 'sucesso',
  p_meta          jsonb DEFAULT '{}'::jsonb,
  p_clinic_id     uuid  DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, app, pg_catalog AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      session_id, request_id, meta)
  VALUES (
      app.current_tenant_id(),
      p_clinic_id,
      app.current_user_id(),
      -- nullif em TODA leitura de GUC: worker e agendamento online nao tem
      -- user_id, e ''::uuid explode com 22P02 e aborta a transacao inteira.
      coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system'),
      p_event_type, p_entity_schema, p_entity_table, p_entity_id, p_outcome,
      nullif(current_setting('app.session_id', true), '')::uuid,
      nullif(current_setting('app.request_id', true), '')::uuid,
      p_meta);

  -- Sem RETURNING de proposito. Com FORCE RLS, um `INSERT ... RETURNING` tambem
  -- aplica as policies de SELECT a linha devolvida, e audit_owner nao tem
  -- nenhuma: a unica policy de leitura (tenant_read, 0010) e TO app_rw. O
  -- RETURNING falharia com 42501 "new row violates row-level security policy",
  -- e a alternativa — dar SELECT ao dono — quebraria a invariante da 0010 de que
  -- nem o dono da trilha a le. currval da sequencia da identidade devolve o id
  -- recem-gerado nesta mesma sessao, sem tocar na linha.
  v_id := currval(pg_get_serial_sequence('audit.event', 'id'));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log(text,text,text,uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log(text,text,text,uuid,text,jsonb,uuid)
  TO app_rw, clin_writer;

RESET ROLE;
