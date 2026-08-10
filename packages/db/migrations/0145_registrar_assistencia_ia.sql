-- 0145_registrar_assistencia_ia.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §6 — registro de assistencia por IA.
--
-- `clin.ai_assistance` e acervo clinico: `app_rw` so tem SELECT, e quem escreve
-- e `clin_writer`, pelo mesmo motivo de `clin.encounter_version` — escrita
-- clinica passa por funcao, nunca por INSERT solto da aplicacao (decisao
-- irreversivel 4). A rota de transcricao esbarrava nisso com "permission denied",
-- que e a regra funcionando.
--
-- A funcao NAO recebe `clinician_decision`. Ela grava sempre `nao_avaliado`, e
-- sair desse estado e outra operacao, feita por uma pessoa. Se o parametro
-- existisse, bastaria um chamador distraido para nascer "aceito" — e o acervo
-- teria sugestao de maquina com aparencia de decisao de medico.

CREATE OR REPLACE FUNCTION clin.record_ai_assistance(
  p_encounter_id  uuid,
  p_purpose       text,
  p_risk_class    text,
  p_provider      text,
  p_model_id      text,
  p_model_version text,
  p_residency     text,
  p_input_hash    bytea,
  p_output        jsonb,
  p_output_hash   bytea
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clin, app
AS $fn$
DECLARE
  v_id      uuid := gen_random_uuid();
  v_patient uuid;
  v_recusou timestamptz;
BEGIN
  SELECT e.patient_id, pat.ai_refused_at
    INTO v_patient, v_recusou
    FROM clin.encounter e
    JOIN clin.patient pat ON (pat.tenant_id, pat.id) = (e.tenant_id, e.patient_id)
   WHERE e.id = p_encounter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'atendimento nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- A recusa e checada AQUI TAMBEM, e nao so na rota.
  --
  -- Nao e redundancia defensiva a toa: a rota checa antes de mandar o audio ao
  -- provedor, que e o que importa para nao vazar. Esta checagem impede que o
  -- registro exista — e um `clin.ai_assistance` de paciente que recusou seria a
  -- prova documental de que a recusa foi ignorada.
  IF v_recusou IS NOT NULL THEN
    RAISE EXCEPTION 'paciente recusou assistencia por IA' USING ERRCODE = '42501';
  END IF;

  INSERT INTO clin.ai_assistance
    (id, encounter_id, patient_id, purpose, risk_class, provider,
     model_id, model_version, residency, input_hash, output, output_hash,
     clinician_decision, patient_refused)
  VALUES
    (v_id, p_encounter_id, v_patient, p_purpose, p_risk_class, p_provider,
     p_model_id, p_model_version, p_residency, p_input_hash, p_output,
     p_output_hash, 'nao_avaliado', false);

  RETURN v_id;
END $fn$;

ALTER FUNCTION clin.record_ai_assistance(
  uuid, text, text, text, text, text, text, bytea, jsonb, bytea)
  OWNER TO clin_writer;
REVOKE ALL ON FUNCTION clin.record_ai_assistance(
  uuid, text, text, text, text, text, text, bytea, jsonb, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.record_ai_assistance(
  uuid, text, text, text, text, text, text, bytea, jsonb, bytea) TO app_rw;

COMMENT ON FUNCTION clin.record_ai_assistance(
  uuid, text, text, text, text, text, text, bytea, jsonb, bytea) IS
  'Registra assistencia por IA sempre como nao_avaliado. Recusa do paciente '
  'bloqueia o registro.';
