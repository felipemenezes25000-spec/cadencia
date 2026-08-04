-- 0043_patient_exists.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §5.4 — O TERCEIRO ESTADO. RLS so sabe devolver conjunto vazio, e "nao existe"
-- nao e a mesma coisa que "existe e voce nao tem acesso". Sem distinguir, o
-- plantonista busca o CPF, recebe "nao encontrado", cria cadastro novo e
-- prescreve sem ver a alergia que estava no primeiro prontuario.
--
-- A funcao e SECURITY DEFINER e ESTREITA de proposito: responde apenas sim/nao
-- sobre existencia NO PROPRIO TENANT, sem conteudo, e registra cada consulta.
-- O tipo de retorno `boolean` e a garantia estrutural: nao ha como esta funcao
-- vazar nome, data de nascimento ou qualquer outra coluna.

-- O dono e clin_writer, o papel das funcoes SECURITY DEFINER do nucleo clinico
-- (migration 0001), e NAO app_owner. Com FORCE ROW LEVEL SECURITY o proprio dono
-- da tabela e filtrado pelas policies, e as de clin.patient_identifier sao todas
-- `TO app_rw`: uma funcao definida por app_owner nao "escaparia" da RLS — ela
-- cairia na negacao por padrao e responderia NAO para todo mundo, que e
-- exatamente o bug que esta migration existe para eliminar.
--
-- clin_writer recebe o MINIMO: SELECT, e sob uma policy propria amarrada ao
-- tenant da transacao, no mesmo desenho da policy `writer` da migration 0030. A
-- policy RESTRICTIVE de escopo clinico (migration 0008) e `TO app_rw` e por isso
-- nao alcanca clin_writer — e disso que vem a resposta que a RLS nao sabe dar.
GRANT SELECT ON clin.patient_identifier TO clin_writer;
CREATE POLICY writer ON clin.patient_identifier AS PERMISSIVE FOR SELECT TO clin_writer
  USING (tenant_id = app.current_tenant_id());

GRANT SELECT ON clin.patient TO clin_writer;
CREATE POLICY writer ON clin.patient AS PERMISSIVE FOR SELECT TO clin_writer
  USING (tenant_id = app.current_tenant_id());

CREATE FUNCTION clin.patient_exists_by_identifier(p_kind text, p_value text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = clin, app, audit, pg_catalog AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_existe boolean;
BEGIN
  -- 'SEM_DOCUMENTO' esta fora da lista de proposito: e o marcador de quem chegou
  -- sem documento nenhum, nao um identificador que alguem possa consultar.
  IF p_kind NOT IN ('CPF','CNS','DNV','PASSAPORTE','RG','CARTEIRINHA') THEN
    RAISE EXCEPTION 'tipo de identificador invalido: %', p_kind USING ERRCODE = '22023';
  END IF;

  -- SECURITY DEFINER escapa da RLS de proposito; o filtro por tenant e EXPLICITO
  -- e vem de app.require_tenant_id(), que levanta 42501 se o preambulo faltar.
  SELECT EXISTS (
    SELECT 1 FROM clin.patient_identifier i
     JOIN clin.patient p ON (p.tenant_id, p.id) = (i.tenant_id, i.patient_id)
    WHERE i.tenant_id = v_tenant AND i.kind = p_kind AND i.value = p_value
      AND p.merged_into_id IS NULL)
  INTO v_existe;

  -- A resposta vai no `outcome`, nao em `meta`: a whitelist de chaves da
  -- migration 0009 (audit.meta_keys_ok) nao tem 'encontrado', e chave fora dela
  -- derruba a linha inteira no CHECK meta_sem_pii. `outcome` ja distingue os dois
  -- casos, e entity_id fica NULL porque consultar existencia por identificador
  -- nao tem entidade a referenciar — e inventar uma seria o vazamento.
  PERFORM audit.log('PATIENT_EXISTENCE_PROBE', 'clin', 'patient_identifier', NULL,
                    CASE WHEN v_existe THEN 'sucesso' ELSE 'negado' END,
                    jsonb_build_object('kind', p_kind), NULL);
  RETURN v_existe;
END $fn$;

ALTER FUNCTION clin.patient_exists_by_identifier(text, text) OWNER TO clin_writer;
REVOKE ALL ON FUNCTION clin.patient_exists_by_identifier(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.patient_exists_by_identifier(text, text) TO app_rw;
