-- 0130_rpt_mv_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — matview de glosas aceitas para Desempenho.
-- Uma linha por glosa aceita (nao recuperada). Usada pelo Explorar e pela
-- decomposicao de variacao (ss5.5 fator "glosas nao recuperadas").
--
-- Propriedade de rpt_owner, SEM GRANT para app_rw (regra ss3.8).

-- ---------------------------------------------------------------------------
-- 1. GRANT USAGE no schema tiss para rpt_owner. Necessario para que a
--    matview (pertencente a rpt_owner, que tem BYPASSRLS) consiga ler as
--    tabelas-fonte no schema tiss. As migrations 0115, 0116 e 0120 ja
--    concedem SELECT tabela a tabela, mas faltava USAGE no schema.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA tiss TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 2. GRANT SELECT na tabela-fonte de glosas para rpt_owner.
--    A tabela tiss.glosa e criada por bloco anterior da Fase 5.
--    Nota: 0125 ja concede SELECT ON tiss.glosa TO rpt_owner.
--    Repetimos aqui por seguranca (GRANT e idempotente).
-- ---------------------------------------------------------------------------
GRANT SELECT ON tiss.glosa TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 3. Matview: uma linha por glosa aceita (status = 'aceita').
--    Campos de dimensao: data_atendimento (periodo), operadora_id,
--    professional_id, clinic_id. Campo de medida: valor_glosado_cents.
-- ---------------------------------------------------------------------------
SET ROLE rpt_owner;

CREATE MATERIALIZED VIEW rpt.mv_glosas AS
SELECT
  rg.id                         AS glosa_id,
  rg.valor_glosado_cents,
  gc.data_atendimento,
  gc.operadora_id,
  enc.professional_id,
  enc.clinic_id,
  rg.created_at                 AS glosa_created_at,
  rg.tenant_id
FROM tiss.glosa rg
JOIN tiss.encounter_guia_consulta gc
  ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
JOIN clin.encounter enc
  ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
WHERE rg.status = 'aceita'
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_glosas
  ON rpt.mv_glosas (tenant_id, glosa_id);
CREATE INDEX ix_mv_glosas_data
  ON rpt.mv_glosas (tenant_id, clinic_id, data_atendimento DESC);

-- ---------------------------------------------------------------------------
-- 4. Funcao de refresh (mesmo padrao de 0107_rpt_refresh_functions.sql).
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_glosas() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_glosas') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_glosas;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_glosas;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_glosas;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_glosas', v_start, clock_timestamp(), v_count, true);
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. GRANTs de execucao para o worker (papel jobs).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_glosas() TO jobs;
