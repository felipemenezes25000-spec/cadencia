-- 0149_procedimentos_publicos.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- A rota `/v1/publico/procedimentos` nasceu consultando `sched.procedure` direto
-- e devolvia lista vazia. O motivo e a propria arquitetura funcionando: a rota
-- roda como `app_rw`, cuja politica exige `app.is_member()` — falso para ator
-- anonimo. As politicas de `sched_public` valem para as FUNCOES dele, nao para
-- quem consulta a tabela de fora.
--
-- A licao e a mesma de 0146: acesso publico passa por funcao, sempre. Consulta
-- direta numa rota aberta funciona ate alguem acrescentar uma coluna ou um JOIN
-- — e ai vaza sem ninguem perceber.
--
-- Preco NAO sai. Valor de procedimento e negociado por convenio e por contrato;
-- publicar a tabela particular numa pagina aberta entrega a politica comercial
-- da clinica para o concorrente da rua de baixo.

CREATE OR REPLACE FUNCTION sched.procedimentos_publicos(p_clinic_id uuid)
RETURNS TABLE (procedure_id uuid, nome text, duracao_min int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, sched, app
AS $fn$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT c.tenant_id INTO v_tenant FROM app.clinic c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unidade nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  RETURN QUERY
  SELECT p.id, p.nome, p.duracao_min
    FROM sched.procedure p
   WHERE p.tenant_id = v_tenant
     AND p.archived_at IS NULL
   ORDER BY p.nome COLLATE "pt-BR-x-icu";
END $fn$;

ALTER FUNCTION sched.procedimentos_publicos(uuid) OWNER TO sched_public;
REVOKE ALL ON FUNCTION sched.procedimentos_publicos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sched.procedimentos_publicos(uuid) TO app_rw;
