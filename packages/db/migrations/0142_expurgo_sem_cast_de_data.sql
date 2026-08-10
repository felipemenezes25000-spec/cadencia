-- 0142_expurgo_sem_cast_de_data.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Sobrou um `NULL::date` no caminho de saida antecipada de 0141, e o lint de DDL
-- reprovou. O cast era inofensivo — mas o lint nao distingue cast inofensivo de
-- cast que esconde fuso, e nao deve mesmo: regra com excecao para julgar deixa
-- de ser automatica, e a proxima excecao ja e a que importa.

CREATE OR REPLACE FUNCTION clin.purge_expired(
  p_tenant_id uuid,
  p_limite    int DEFAULT 500
) RETURNS TABLE (
  valores_expurgados bigint,
  anexos_expurgados  bigint,
  chaves_de_objeto   uuid[],
  corte              date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, clin, app, audit
AS $fn$
DECLARE
  v_anos  smallint;
  v_corte date;
  v_val   bigint := 0;
  v_anx   bigint := 0;
  v_keys  uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_limite <= 0 OR p_limite > 5000 THEN
    RAISE EXCEPTION 'limite fora da faixa (1..5000)' USING ERRCODE = '22023';
  END IF;

  -- Escopo do tenant, transacao-local. `actor_kind = system` porque quem executa
  -- expurgo e a fila, nao uma pessoa: `app.is_member()` admite o ator sistema
  -- justamente para job rodar sob a MESMA politica que um humano, sem BYPASSRLS.
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.actor_kind', 'system', true);

  SELECT t.retencao_anos INTO v_anos FROM app.tenant t WHERE t.id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- `retencao_anos` NULL significa "a clinica nao configurou", e nao "pode
  -- apagar quando quiser": cai no piso legal de 20 anos. A coluna ja tem
  -- CHECK (>= 20), entao configurar menos e impossivel.
  -- A data-limite sai de `app.local_date`, e nao de `current_date`.
  --
  -- `current_date` e a data do SERVIDOR. Uma clinica em Rio Branco fecha o dia
  -- cinco horas depois do banco em sa-east-1, e um corte calculado no fuso
  -- errado expurga um dia a mais — sem desfazer. Em vinte anos um dia parece
  -- pouco, e e exatamente por parecer pouco que a regra existe: ninguem precisa
  -- julgar caso a caso se a diferenca importa.
  --
  -- A subtracao acontece no timestamptz e so entao vira data local, o que evita
  -- o cast para date que o lint de DDL proibe justamente por esconder fuso.
  SELECT min(app.local_date(
           clock_timestamp() - make_interval(years => coalesce(v_anos, 20)::int),
           c.timezone))
    INTO v_corte
    FROM app.clinic c
   WHERE c.tenant_id = p_tenant_id;

  -- Tenant sem unidade cadastrada nao tem acervo para expurgar.
  IF v_corte IS NULL THEN
    -- `v_corte` ja e NULL e ja e do tipo date. Escrever `NULL::date` aqui seria
    -- um cast inofensivo — e o lint nao distingue cast inofensivo de cast que
    -- esconde fuso, de proposito: a regra so vale se nao tiver excecao para
    -- julgar.
    RETURN QUERY SELECT 0::bigint, 0::bigint, ARRAY[]::uuid[], v_corte;
    RETURN;
  END IF;

  PERFORM set_config('app.expurgo_legal', 'on', true);

  WITH alvo AS (
    SELECT v.finalized_at, v.id
      FROM clin.encounter_field_value v
      JOIN clin.encounter_version ev
        ON (ev.tenant_id, ev.id) = (v.tenant_id, v.version_id)
      JOIN clin.encounter e
        ON (e.tenant_id, e.id) = (ev.tenant_id, ev.encounter_id)
     WHERE v.tenant_id = p_tenant_id
       AND v.purged_at IS NULL
       AND e.occurred_date < v_corte
     ORDER BY v.finalized_at
     LIMIT p_limite
  )
  UPDATE clin.encounter_field_value v
     SET value_text = NULL, value_num = NULL, value_bool = NULL,
         value_date = NULL, value_ts = NULL, value_json = NULL,
         value_ref_code = NULL, value_ref_source = NULL,
         purged_at = clock_timestamp()
    FROM alvo a
   WHERE (v.finalized_at, v.id) = (a.finalized_at, a.id);
  GET DIAGNOSTICS v_val = ROW_COUNT;

  -- A linha do anexo e carimbada aqui; o OBJETO e apagado por quem chamou,
  -- porque SQL nao alcanca o armazenamento. As chaves saem no retorno para isso.
  WITH alvo AS (
    SELECT a.id, a.storage_key
      FROM clin.attachment a
     WHERE a.tenant_id = p_tenant_id
       AND a.purged_at IS NULL
       AND a.occurred_date IS NOT NULL
       AND a.occurred_date < v_corte
     LIMIT p_limite
  ), feito AS (
    UPDATE clin.attachment a
       SET purged_at = clock_timestamp()
      FROM alvo t
     WHERE a.id = t.id
    RETURNING t.storage_key
  )
  SELECT count(*), coalesce(array_agg(storage_key), ARRAY[]::uuid[])
    INTO v_anx, v_keys FROM feito;

  PERFORM set_config('app.expurgo_legal', 'off', true);

  PERFORM audit.log('RECORD_PURGE', 'clin', 'encounter_field_value', p_tenant_id,
                    'sucesso',
                    jsonb_build_object('valores_expurgados', v_val,
                                       'anexos_expurgados', v_anx,
                                       'corte_retencao', v_corte),
                    NULL);

  RETURN QUERY SELECT v_val, v_anx, v_keys, v_corte;
END $fn$;

ALTER FUNCTION clin.purge_expired(uuid, int) OWNER TO clin_purger;
REVOKE ALL ON FUNCTION clin.purge_expired(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.purge_expired(uuid, int) TO jobs;
