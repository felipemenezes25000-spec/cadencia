-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.8 — Funcoes de refresh por matview. SECURITY DEFINER pertencentes a rpt_owner.
-- Chamadas pelo worker (papel jobs) com frequencia configuravel.
-- NUNCA full refresh em horario comercial — apenas periodos fechados.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- Funcao auxiliar: verifica se a matview ja foi populada ao menos uma vez.
-- Necessario porque REFRESH CONCURRENTLY exige que a matview tenha dados.
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.is_populated(p_matview text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT c.relispopulated
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'rpt' AND c.relname = p_matview
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_atendimentos
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_atendimentos() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_atendimentos') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_atendimentos;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_atendimentos;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_atendimentos;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_atendimentos', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_financeiro
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_financeiro() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_financeiro') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_financeiro;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_financeiro;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_financeiro;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_financeiro', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_agenda
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_agenda() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_agenda') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_agenda;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_agenda;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_agenda;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_agenda', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_pacientes
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_pacientes() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_pacientes') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_pacientes;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_pacientes;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_pacientes;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_pacientes', v_start, clock_timestamp(), v_count, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- rpt.refresh_mv_satisfacao
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_satisfacao() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_satisfacao') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_satisfacao;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_satisfacao;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_satisfacao;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_satisfacao', v_start, clock_timestamp(), v_count, true);
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANTs: o worker (papel jobs) precisa de EXECUTE nas funcoes de refresh.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_atendimentos()  TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_financeiro()    TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_agenda()        TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_pacientes()     TO jobs;
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_satisfacao()    TO jobs;
GRANT EXECUTE ON FUNCTION rpt.is_populated(text)         TO jobs;
