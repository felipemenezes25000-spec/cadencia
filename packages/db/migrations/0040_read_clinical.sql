-- 0040_read_clinical.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.5 — o registro vigente e o CONJUNTO de versoes nao superadas.
-- O cenario que isto evita: v1 = consulta; v2 = adendo com o hemograma que
-- chegou dois dias depois; v3 = retificacao de v1. Lendo so o head_version_id,
-- o hemograma SOME da tela do medico na consulta seguinte — e nada alerta.
--
-- §3.7 — acesso clinico passa por funcao que registra ANTES de retornar,
-- deduplicada por (usuario, paciente, caso de uso) em janela de 5 minutos.

-- security_invoker = true nao e detalhe: sem ele a view executa com os
-- privilegios do dono (app_owner), que nao tem policy nenhuma em
-- clin.encounter_version — e com FORCE RLS a view devolveria ZERO linha para
-- todo mundo. O invariante #1 (packages/db/src/invariants/inv01-rls.ts) reprova
-- view sem ele exatamente por isso.
CREATE VIEW clin.v_version_status
  WITH (security_barrier = true, security_invoker = true) AS
SELECT v.*,
       (s.id IS NOT NULL) AS superseded,
       s.id               AS superseded_by,
       s.finalized_at     AS superseded_at
  FROM clin.encounter_version v
  LEFT JOIN clin.encounter_version s
         ON (s.tenant_id, s.supersedes_version_id) = (v.tenant_id, v.id);
ALTER VIEW clin.v_version_status OWNER TO app_owner;
GRANT SELECT ON clin.v_version_status TO app_rw;

-- ---------------------------------------------------------------------------
-- clin.read_encounter — versoes VIVAS de um atendimento, com auditoria.
-- SECURITY INVOKER de proposito: a RLS do chamador continua valendo, e a funcao
-- so acrescenta o registro da leitura. SECURITY DEFINER aqui abriria o prontuario
-- inteiro para quem chamasse a funcao.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clin.read_encounter(p_encounter_id uuid)
RETURNS TABLE (
  version_id uuid, version_no int, kind clin.version_kind,
  justificativa text, author_professional_id uuid, incompleto boolean,
  finalized_at timestamptz(3), superseded boolean)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_patient uuid;
BEGIN
  SELECT e.patient_id INTO v_patient FROM clin.encounter e WHERE e.id = p_encounter_id;
  IF v_patient IS NULL THEN
    RETURN;   -- zero linhas: a RLS ja disse tudo o que tinha a dizer.
  END IF;

  PERFORM audit.log_read('encounter_read', v_patient);

  RETURN QUERY
    SELECT s.id, s.version_no, s.kind, s.justificativa, s.author_professional_id,
           s.incompleto, s.finalized_at, s.superseded
      FROM clin.v_version_status s
     WHERE s.encounter_id = p_encounter_id AND NOT s.superseded
     ORDER BY s.version_no;
END $fn$;
ALTER FUNCTION clin.read_encounter(uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION clin.read_encounter(uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- clin.read_patient_record — a linha do tempo. Alvo < 10 ms para 20 atendimentos.
-- Index Only Scan em ix_encounter_hist -> nested loop nas versoes vivas.
-- Sem recursao, sem fold, sem window function, sem DISTINCT ON.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clin.read_patient_record(
  p_patient_id uuid, p_limit int DEFAULT 20, p_before date DEFAULT NULL)
RETURNS TABLE (
  encounter_id uuid, occurred_date date, occurred_at timestamptz(3),
  professional_id uuid, clinic_id uuid, status clin.encounter_status,
  versoes_vivas int)
LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  PERFORM audit.log_read('patient_timeline', p_patient_id);

  RETURN QUERY
    SELECT e.id, e.occurred_date, e.occurred_at, e.professional_id, e.clinic_id, e.status,
           (SELECT count(*)::int FROM clin.v_version_status s
             WHERE s.encounter_id = e.id AND NOT s.superseded) AS versoes_vivas
      FROM clin.encounter e
     WHERE e.patient_id = p_patient_id
       AND (p_before IS NULL OR e.occurred_date < p_before)
     ORDER BY e.occurred_date DESC, e.id DESC
     LIMIT greatest(p_limit, 1);
END $fn$;
ALTER FUNCTION clin.read_patient_record(uuid, int, date) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION clin.read_patient_record(uuid, int, date) TO app_rw;
