-- 0067_fix_finalize_ambiguous_version_id_066_regression.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- A 0066 reescreveu clin.finalize_encounter mas perdeu os alias de tabela que a
-- 0038 tinha adicionado no PASSO 6 (supersessao). Resultado: 42702 "column
-- reference version_id is ambiguous" na retificacao/adendo. Este e o mesmo bug
-- da 0038, reintroduzido por copiar o corpo sem os qualificadores.

CREATE OR REPLACE FUNCTION clin.finalize_encounter(
  p_encounter_id        uuid,
  p_kind                clin.version_kind,
  p_payload             jsonb,
  p_content_hash        bytea,
  p_serializer_version  text,
  p_supersedes_version_id uuid DEFAULT NULL,
  p_justificativa       text  DEFAULT NULL,
  p_incompleto          boolean DEFAULT false)
RETURNS TABLE (version_id uuid, version_no int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = clin, app, ref, audit, pg_catalog AS $fn$
DECLARE
  v_enc        clin.encounter%ROWTYPE;
  v_version_id uuid := gen_random_uuid();
  v_version_no int;
  v_prev_hash  bytea;
  v_prof       uuid := coalesce(app.current_professional_id(),
    CASE WHEN nullif(current_setting('app.actor_kind', true), '') = 'system'
         THEN (SELECT e.professional_id FROM clin.encounter e WHERE e.id = p_encounter_id)
         END);
  v_author     uuid := coalesce(app.current_user_id(),
    CASE WHEN nullif(current_setting('app.actor_kind', true), '') = 'system'
         THEN (SELECT p.user_id FROM app.professional p WHERE p.id = v_prof)
         END);
  v_finalized  timestamptz(3) := clock_timestamp();
  v_item       jsonb;
  v_value_date date;
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quem finaliza precisa ser profissional deste tenant'
      USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_content_hash) <> 32 THEN
    RAISE EXCEPTION 'content_hash precisa ter 32 bytes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_enc FROM clin.encounter e
   WHERE e.id = p_encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'atendimento % nao encontrado', p_encounter_id USING ERRCODE = 'P0002';
  END IF;
  IF p_kind = 'original' AND v_enc.status <> 'rascunho' THEN
    RAISE EXCEPTION 'atendimento nao esta em rascunho' USING ERRCODE = '55000';
  END IF;
  IF p_kind <> 'original' AND v_enc.status = 'rascunho' THEN
    RAISE EXCEPTION 'nao existe retificacao de atendimento nao finalizado'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_version_no
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id;
  SELECT v.content_hash INTO v_prev_hash
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id
    ORDER BY v.version_no DESC LIMIT 1;

  INSERT INTO clin.encounter_version (
      tenant_id, id, encounter_id, version_no, kind, supersedes_version_id,
      justificativa, author_user_id, author_professional_id, incompleto,
      finalized_at, content_hash, prev_hash, serializer_version)
  VALUES (
      v_enc.tenant_id, v_version_id, p_encounter_id, v_version_no, p_kind,
      p_supersedes_version_id, p_justificativa, v_author, v_prof,
      p_incompleto, v_finalized, p_content_hash, v_prev_hash, p_serializer_version);

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'fields', '[]'::jsonb))
  LOOP
    v_value_date := v_item->>'value_date';
    INSERT INTO clin.encounter_field_value (
        tenant_id, id, version_id, finalized_at, field_id, field_generation,
        label_snapshot, display_snapshot, terminology_version,
        section_instance, ordinal,
        value_text, value_num, value_bool, value_date, value_ts, value_json,
        value_ref_source, value_ref_code)
    VALUES (
        v_enc.tenant_id, gen_random_uuid(), v_version_id, v_finalized,
        (v_item->>'field_id')::uuid,
        coalesce((v_item->>'field_generation')::int, 1),
        v_item->>'label',
        v_item->>'display_snapshot',
        v_item->>'terminology_version',
        coalesce((v_item->>'section_instance')::smallint, 1),
        coalesce((v_item->>'ordinal')::int, 0),
        v_item->>'value_text',
        (v_item->>'value_num')::numeric,
        (v_item->>'value_bool')::boolean,
        v_value_date,
        (v_item->>'value_ts')::timestamptz,
        v_item->'value_json',
        v_item->>'value_ref_source',
        v_item->>'value_ref_code');
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'diagnoses','[]'::jsonb))
  LOOP
    INSERT INTO clin.diagnosis (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, code_system, code, display_snapshot, terminology_version, is_principal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'code_system', v_item->>'code', v_item->>'display_snapshot',
        v_item->>'terminology_version', coalesce((v_item->>'is_principal')::boolean, false));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'observations','[]'::jsonb))
  LOOP
    INSERT INTO clin.observation (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, observation_code, value_num, unit, field_id, component_ordinal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'observation_code', (v_item->>'value_num')::numeric, v_item->>'unit',
        (v_item->>'field_id')::uuid, coalesce((v_item->>'component_ordinal')::int, 0));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'findings','[]'::jsonb))
  LOOP
    INSERT INTO clin.encounter_finding (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, field_id, field_code, option_code, display_snapshot, ordinal)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        (v_item->>'field_id')::uuid, v_item->>'field_code', v_item->>'option_code',
        v_item->>'display_snapshot', coalesce((v_item->>'ordinal')::int, 0));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'procedures','[]'::jsonb))
  LOOP
    INSERT INTO clin.procedure (
        tenant_id, id, encounter_id, version_id, patient_id, professional_id, clinic_id,
        occurred_date, code_system, tabela, code, display_snapshot, terminology_version,
        quantidade, valor_centavos)
    VALUES (v_enc.tenant_id, gen_random_uuid(), p_encounter_id, v_version_id,
        v_enc.patient_id, v_prof, v_enc.clinic_id, v_enc.occurred_date,
        v_item->>'code_system', (v_item->>'tabela')::smallint, v_item->>'code',
        v_item->>'display_snapshot', v_item->>'terminology_version',
        coalesce((v_item->>'quantidade')::int, 1),
        coalesce((v_item->>'valor_centavos')::bigint, 0));
  END LOOP;

  UPDATE clin.ai_assistance a
     SET version_id = v_version_id
   WHERE a.tenant_id = v_enc.tenant_id
     AND a.encounter_id = p_encounter_id
     AND a.version_id IS NULL;

  IF p_kind IN ('retificacao','transferencia','anulacao') AND p_supersedes_version_id IS NOT NULL THEN
    UPDATE clin.diagnosis d         SET live = false
     WHERE d.tenant_id = v_enc.tenant_id AND d.version_id = p_supersedes_version_id;
    UPDATE clin.observation o       SET live = false
     WHERE o.tenant_id = v_enc.tenant_id AND o.version_id = p_supersedes_version_id;
    UPDATE clin.encounter_finding f SET live = false
     WHERE f.tenant_id = v_enc.tenant_id AND f.version_id = p_supersedes_version_id;
    UPDATE clin.procedure pr        SET live = false
     WHERE pr.tenant_id = v_enc.tenant_id AND pr.version_id = p_supersedes_version_id;
  END IF;

  DELETE FROM clin.encounter_draft d
   WHERE d.tenant_id = v_enc.tenant_id AND d.encounter_id = p_encounter_id;

  UPDATE clin.encounter e
     SET head_version_id = CASE WHEN p_kind = 'adendo' THEN e.head_version_id ELSE v_version_id END,
         version_count   = e.version_count + 1,
         status          = CASE WHEN p_kind = 'anulacao' THEN 'anulado'::clin.encounter_status
                                ELSE 'finalizado'::clin.encounter_status END
   WHERE e.tenant_id = v_enc.tenant_id AND e.id = p_encounter_id;

  PERFORM audit.log(
    CASE p_kind
      WHEN 'original'      THEN 'ENCOUNTER_FINALIZE'
      WHEN 'retificacao'   THEN 'ENCOUNTER_AMEND'
      WHEN 'adendo'        THEN 'ENCOUNTER_ADDENDUM'
      WHEN 'transferencia' THEN 'ENCOUNTER_TRANSFER'
      WHEN 'anulacao'      THEN 'ENCOUNTER_VOID'
    END,
    'clin', 'encounter_version', p_encounter_id, 'sucesso',
    jsonb_build_object('version_no', v_version_no, 'kind', p_kind::text),
    v_enc.clinic_id);

  RETURN QUERY SELECT v_version_id, v_version_no;
END $fn$;
