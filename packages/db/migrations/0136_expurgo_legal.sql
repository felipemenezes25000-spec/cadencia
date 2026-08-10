-- 0136_expurgo_legal.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.10 — EXPURGO LEGAL.
--
-- O acervo clinico e append-only por gatilho: `clin.deny_mutation` recusa UPDATE
-- e DELETE "para qualquer papel", superusuario incluso. Isso e o que sustenta a
-- garantia central do produto, e continua valendo.
--
-- Mas guarda de 20 anos nao e guarda para sempre. Passado o prazo do CFM
-- (Resolucao 1.821/2007, 20 anos a contar do ultimo registro), a clinica PODE
-- destruir — e a LGPD, em alguns casos, obriga. Sem uma porta para isso, o
-- sistema acumula dado de saude indefinidamente, o que e o oposto de minimizar.
--
-- A porta e estreita de proposito. O expurgo NAO altera registro clinico: ele
-- DESTROI o conteudo e deixa a linha. Quem consulta depois ve que existiu um
-- valor, quando foi expurgado, e nao ve o valor. A cadeia de hash das versoes
-- continua intacta porque `clin.encounter_version` nao e tocada.
--
-- As cinco condicoes abaixo sao cumulativas. Qualquer uma que falte, recusa.

CREATE OR REPLACE FUNCTION clin.deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.expurgo_legal', true) = 'on' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    -- 1) A tabela tem que ter `purged_at`. Tabela sem a coluna nunca e expurgavel
    --    por este caminho — encounter_version, por exemplo, jamais.
    -- 2) So a transicao NULL -> preenchido. Reexpurgar, ou mexer no carimbo de
    --    um expurgo antigo, e recusado.
    IF (v_old ? 'purged_at')
       AND v_old->>'purged_at' IS NULL
       AND v_new->>'purged_at' IS NOT NULL
    THEN
      -- 3) O conteudo tem que ficar REALMENTE nulo. Sem isto, "expurgar" poderia
      --    marcar a linha como expurgada mantendo o dado — pior do que nao
      --    expurgar, porque a auditoria acreditaria que o dado sumiu.
      IF TG_TABLE_NAME LIKE 'encounter_field_value%' THEN
        IF num_nonnulls(NEW.value_text, NEW.value_num, NEW.value_bool,
                        NEW.value_date, NEW.value_ts, NEW.value_json,
                        NEW.value_ref_code) <> 0 THEN
          RAISE EXCEPTION
            'expurgo incompleto: o valor precisa ficar nulo, nao apenas marcado'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      -- 4) Nada mais pode mudar junto. Um UPDATE que aproveitasse a janela do
      --    expurgo para corrigir um label ou trocar o version_id seria adulteracao
      --    com aparencia de conformidade.
      IF (v_old - 'purged_at' - 'value_text' - 'value_num' - 'value_bool'
                - 'value_date' - 'value_ts' - 'value_json' - 'value_ref_code'
                - 'value_ref_source')
         IS DISTINCT FROM
         (v_new - 'purged_at' - 'value_text' - 'value_num' - 'value_bool'
                - 'value_date' - 'value_ts' - 'value_json' - 'value_ref_code'
                - 'value_ref_source')
      THEN
        RAISE EXCEPTION
          'expurgo nao pode alterar nenhum outro campo da linha'
          USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- 5) Fora disso, a regra de sempre. DELETE nunca passa por aqui.
  RAISE EXCEPTION 'clin.% e append-only: UPDATE e DELETE sao proibidos para qualquer papel',
        TG_TABLE_NAME USING ERRCODE = '42501';
END $fn$;

COMMENT ON FUNCTION clin.deny_mutation() IS
  'Append-only. Unica excecao: expurgo legal §3.10, sob app.expurgo_legal=on, '
  'somente destruindo conteudo e carimbando purged_at.';

-- ── a funcao de expurgo ─────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque `app_rw` nao tem UPDATE em tabela clinica e nao vai
-- ter: a permissao mora aqui, com a regra junto. Aplicacao pede o expurgo; quem
-- decide o que e expurgavel e o banco.
--
-- A JANELA E CALCULADA AQUI, e nao recebida por parametro. Se o prazo viesse de
-- fora, um chamador distraido (ou um bug) apagaria acervo dentro da guarda legal
-- — e nao ha desfazer.

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
SET search_path = pg_catalog, clin, app
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

  SELECT t.retencao_anos INTO v_anos FROM app.tenant t WHERE t.id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- `retencao_anos` NULL significa "a clinica nao configurou", e nao "pode
  -- apagar quando quiser": cai no piso legal de 20 anos. A coluna ja tem
  -- CHECK (>= 20), entao configurar menos e impossivel.
  v_corte := (current_date - make_interval(years => coalesce(v_anos, 20)::int))::date;

  PERFORM set_config('app.expurgo_legal', 'on', true);

  -- ── valores de campo ──────────────────────────────────────────────────────
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

  -- ── anexos ────────────────────────────────────────────────────────────────
  -- A linha e carimbada aqui; o OBJETO e apagado por quem chamou, porque SQL nao
  -- alcanca o armazenamento. As chaves saem no retorno exatamente para isso.
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
                    jsonb_build_object('valores', v_val, 'anexos', v_anx,
                                       'corte', v_corte),
                    NULL);

  RETURN QUERY SELECT v_val, v_anx, v_keys, v_corte;
END $fn$;

ALTER FUNCTION clin.purge_expired(uuid, int) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.purge_expired(uuid, int) FROM PUBLIC;
-- So o papel de jobs executa. Expurgo nao e acao de tela: nao ha botao "apagar
-- prontuario", e nao pode haver.
GRANT EXECUTE ON FUNCTION clin.purge_expired(uuid, int) TO jobs;

COMMENT ON FUNCTION clin.purge_expired(uuid, int) IS
  'Expurgo legal §3.10: destroi conteudo clinico fora da guarda de retencao. '
  'A janela e calculada no banco, nunca recebida do chamador.';
