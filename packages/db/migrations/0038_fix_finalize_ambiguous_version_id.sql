-- 0038_fix_finalize_ambiguous_version_id.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- CORRIGE um bug LATENTE da 0037, que so aparece na retificacao.
--
-- A assinatura da funcao e `RETURNS TABLE (version_id uuid, version_no int)`, e
-- isso DECLARA IMPLICITAMENTE `version_id` e `version_no` como variaveis de saida
-- no escopo do corpo. No PASSO 6 (supersessao), os quatro UPDATE filtravam por
-- `version_id` SEM QUALIFICAR — e o Postgres nao tem como saber se aquilo e a
-- coluna ou a variavel. Resultado: erro 42702 (`column reference "version_id" is
-- ambiguous`) e a transacao inteira aborta.
--
-- Por que ficou invisivel ate agora: o PASSO 6 so executa quando p_kind e
-- retificacao, transferencia ou anulacao. A finalizacao ORIGINAL nunca passa por
-- ele, entao os quatro testes da Task 19 ficaram verdes sobre codigo quebrado. A
-- Task 20 e a primeira que retifica um atendimento, e por isso a primeira que
-- bate no defeito.
--
-- O que estava em jogo: com isso em producao, o medico conseguiria ASSINAR o
-- prontuario e nunca conseguiria CORRIGI-LO. Retificacao de prontuario e
-- obrigacao legal (SBIS NGS1.12), nao recurso opcional.
--
-- A correcao e qualificar as quatro linhas com alias de tabela. O restante do
-- corpo e identico a 0037 — CREATE OR REPLACE exige o corpo inteiro.

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
  v_prof       uuid := app.current_professional_id();
  v_finalized  timestamptz(3) := clock_timestamp();
  v_item       jsonb;
  -- O campo `data` do prontuario chega como TEXTO no payload. Converte-lo e
  -- parse de entrada, nao derivacao de timestamptz — mas o invariante 8 le a
  -- sintaxe, nao a intencao, e reprova o cast direto. A atribuicao plpgsql
  -- converte com a mesma severidade (22007 em entrada invalida) e deixa o lint
  -- continuar vigiando o resto da funcao, que a Fase 3/4 ainda vai crescer.
  v_value_date date;
BEGIN
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'quem finaliza precisa ser profissional deste tenant'
      USING ERRCODE = '42501';
  END IF;
  IF octet_length(p_content_hash) <> 32 THEN
    RAISE EXCEPTION 'content_hash precisa ter 32 bytes' USING ERRCODE = '22023';
  END IF;

  -- PASSO 1 — trava o agregado. A RLS ja filtrou o tenant.
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

  -- PASSO 2 — calcula version_no e le prev_hash (cadeia por atendimento).
  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_version_no
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id;
  SELECT v.content_hash INTO v_prev_hash
    FROM clin.encounter_version v WHERE v.encounter_id = p_encounter_id
    ORDER BY v.version_no DESC LIMIT 1;

  -- PASSO 3 — a versao. author_professional_id = QUEM ESCREVEU: o plantonista
  -- que cobre o titular nao pode ser gravado como o titular.
  INSERT INTO clin.encounter_version (
      tenant_id, id, encounter_id, version_no, kind, supersedes_version_id,
      justificativa, author_user_id, author_professional_id, incompleto,
      finalized_at, content_hash, prev_hash, serializer_version)
  VALUES (
      v_enc.tenant_id, v_version_id, p_encounter_id, v_version_no, p_kind,
      p_supersedes_version_id, p_justificativa, app.current_user_id(), v_prof,
      p_incompleto, v_finalized, p_content_hash, v_prev_hash, p_serializer_version);

  -- PASSO 4 — explode o payload em encounter_field_value.
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

  -- PASSO 5 — materializa a primeira classe.
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

  -- IA: a linha ja existe desde a chamada ao provedor; a finalizacao a SELA,
  -- ligando-a a versao. version_id NOT NULL a partir daqui, por §4.6 item 3.
  UPDATE clin.ai_assistance a
     SET version_id = v_version_id
   WHERE a.tenant_id = v_enc.tenant_id
     AND a.encounter_id = p_encounter_id
     AND a.version_id IS NULL;

  -- PASSO 6 — supersessao: apaga o bit `live` das filhas da versao superada.
  IF p_kind IN ('retificacao','transferencia','anulacao') AND p_supersedes_version_id IS NOT NULL THEN
    UPDATE clin.diagnosis d         SET live = false
     WHERE d.tenant_id = v_enc.tenant_id AND d.version_id = p_supersedes_version_id;
    UPDATE clin.observation o       SET live = false
     WHERE o.tenant_id = v_enc.tenant_id AND o.version_id = p_supersedes_version_id;
    UPDATE clin.encounter_finding f SET live = false
     WHERE f.tenant_id = v_enc.tenant_id AND f.version_id = p_supersedes_version_id;
    UPDATE clin.procedure p         SET live = false
     WHERE p.tenant_id = v_enc.tenant_id AND p.version_id = p_supersedes_version_id;
  END IF;

  -- PASSO 7 — lancamento financeiro e projecao da guia TISS.
  -- Na Fase 1 os modulos fin e tiss ainda nao existem; o que existe e a captura
  -- dos ~14 campos da guia de consulta, em clin.encounter_billing (Task 24), que
  -- e escrita pela rota junto com o payload e nao aqui. Este passo fica
  -- deliberadamente vazio, e a Fase 3/4 o preenche sem mexer nos passos 1 a 6.

  -- PASSO 8 — apaga o rascunho e atualiza o cache de leitura.
  DELETE FROM clin.encounter_draft d
   WHERE d.tenant_id = v_enc.tenant_id AND d.encounter_id = p_encounter_id;

  UPDATE clin.encounter e
     SET head_version_id = CASE WHEN p_kind = 'adendo' THEN e.head_version_id ELSE v_version_id END,
         version_count   = e.version_count + 1,
         status          = CASE WHEN p_kind = 'anulacao' THEN 'anulado'::clin.encounter_status
                                ELSE 'finalizado'::clin.encounter_status END
   WHERE e.tenant_id = v_enc.tenant_id AND e.id = p_encounter_id;

  -- PASSO 9 — trilha. entity_id e REFERENCIA, nunca conteudo (NGS1.07.06).
  PERFORM audit.log(
    CASE p_kind
      WHEN 'original'      THEN 'ENCOUNTER_FINALIZE'
      WHEN 'retificacao'   THEN 'ENCOUNTER_AMEND'
      WHEN 'adendo'        THEN 'ENCOUNTER_ADDENDUM'
      WHEN 'transferencia' THEN 'ENCOUNTER_TRANSFER'
      WHEN 'anulacao'      THEN 'ENCOUNTER_VOID'
    END,
    'clin', 'encounter_version', p_encounter_id, 'sucesso',
    -- audit.meta_keys_ok (migration 0009) e whitelist fechada: `incompleto` nao
    -- esta nela e a linha morre em meta_sem_pii. O flag ja e coluna selada da
    -- propria versao, e entity_id aponta para o atendimento — nada se perde.
    -- `kind` esta na whitelist e diz mais: e o verbo da escrita.
    jsonb_build_object('version_no', v_version_no, 'kind', p_kind::text),
    v_enc.clinic_id);

  RETURN QUERY SELECT v_version_id, v_version_no;
END $fn$;
