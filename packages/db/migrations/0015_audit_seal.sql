-- 0015_audit_seal.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Selo diario: a unica garantia real de imutabilidade. Dentro do banco,
-- superusuario sempre vence REVOKE; o que resta e adulteracao DETECTAVEL.
-- Roda como `jobs`, unico papel com BYPASSRLS: sem ele o selo leria zero
-- linhas e reportaria sucesso para sempre.

-- pg_read_all_stats e necessario para a marca d'agua de visibilidade. Em
-- producao o GRANT pertence ao bootstrap (superusuario); aqui ele e tentado e,
-- se faltar privilegio, o teste de CI reprova alto em vez de o selo cegar.
DO $$
BEGIN
  EXECUTE 'GRANT pg_read_all_stats TO jobs';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'GRANT pg_read_all_stats TO jobs precisa ser feito pelo superusuario de bootstrap';
END $$;

SET ROLE audit_owner;

GRANT USAGE ON SCHEMA audit TO jobs;
GRANT SELECT ON audit.event TO jobs;

CREATE TABLE audit.seal (
  tenant_id uuid NOT NULL, seal_date date NOT NULL,
  first_id bigint NOT NULL, last_id bigint NOT NULL, row_count bigint NOT NULL,
  chain_hash bytea NOT NULL, prev_chain_hash bytea,
  -- Marca d'agua de visibilidade: o dia D so e selado quando nao ha transacao
  -- com escrita mais antiga que o inicio de D+1. Sem isso, um lote TISS que
  -- comeca 23h58 e commita 00h03 entra num dia ja selado e a verificacao futura
  -- acusa adulteracao de um sistema que funcionou perfeitamente.
  snapshot_xmin bigint NOT NULL,
  signed_pkcs7 bytea, sealed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, seal_date));

ALTER TABLE audit.seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.seal FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON audit.seal FROM PUBLIC, app_rw, app_owner;
GRANT SELECT ON audit.seal TO app_rw;
GRANT SELECT, INSERT ON audit.seal TO jobs;
CREATE POLICY tenant_read ON audit.seal AS PERMISSIVE FOR SELECT TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
CREATE POLICY owner_all ON audit.seal AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);

-- Registro de EXECUCAO do job. E sobre esta tabela que o dead man's switch
-- opera: o alarme e por AUSENCIA de execucao, nao so por erro.
CREATE TABLE audit.seal_run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid,                       -- NULL = execucao global do job
  seal_date date NOT NULL,
  started_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz(3),
  outcome text NOT NULL CHECK (outcome IN ('sucesso','adiado','erro')),
  detail text);

ALTER TABLE audit.seal_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.seal_run FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON audit.seal_run FROM PUBLIC, app_rw, app_owner;
GRANT SELECT, INSERT ON audit.seal_run TO jobs;
CREATE POLICY owner_all ON audit.seal_run AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);

-- SECURITY INVOKER de proposito: roda como `jobs` e usa o BYPASSRLS dele para
-- enxergar todos os tenants. Como SECURITY DEFINER (audit_owner) a RLS forcada
-- devolveria zero linhas e o selo seria de um dia vazio.
CREATE FUNCTION audit.seal_day(p_tenant uuid, p_date date) RETURNS audit.seal
LANGUAGE plpgsql
SET search_path = audit, pg_catalog AS $$
DECLARE
  v_cut  timestamptz := (p_date + 1)::timestamptz;   -- inicio de D+1
  v_xmin bigint;
  v_prev bytea;
  v_row  audit.seal;
BEGIN
  v_xmin := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;

  -- So bloqueia transacao que JA ESCREVEU (isto e, que ja adquiriu XID): e a
  -- unica que pode ter linhas com occurred_at dentro do dia fechado e ainda
  -- invisiveis. O lote TISS que comeca 23h58, INSERE antes da meia-noite e
  -- commita 00h03 cai aqui — que e o caso que o selo existe para cobrir.
  -- Transacao aberta e ociosa, ou somente-leitura, nao adia nada.
  IF EXISTS (
      SELECT 1 FROM pg_stat_activity a
       WHERE a.datname = current_database()
         AND a.pid <> pg_backend_pid()
         AND a.xact_start IS NOT NULL
         AND a.xact_start < v_cut
         AND a.backend_xid IS NOT NULL)
  THEN
    RAISE EXCEPTION 'selo adiado: transacao com escrita aberta desde antes de % ainda em curso', v_cut
      USING ERRCODE = '55006',
            HINT = 'Rode o selo de novo quando a transacao antiga terminar.';
  END IF;

  SELECT s.chain_hash INTO v_prev
    FROM audit.seal s
   WHERE s.tenant_id = p_tenant AND s.seal_date < p_date
   ORDER BY s.seal_date DESC
   LIMIT 1;

  INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id, row_count,
                          chain_hash, prev_chain_hash, snapshot_xmin)
  SELECT p_tenant, p_date,
         coalesce(min(e.id), 0), coalesce(max(e.id), 0), count(*),
         -- sha256() e do pg_catalog: nao depende do pgcrypto nem de USAGE em
         -- `public`, que a §3.1 revoga de PUBLIC. Com digest(), o selo falharia
         -- com 42883 na primeira execucao noturna, em silencio.
         sha256(
           coalesce(v_prev, ''::bytea) ||
           convert_to(coalesce(string_agg(
               e.id || '|' ||
               to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '|' ||
               e.event_type || '|' || e.outcome || '|' ||
               coalesce(e.entity_id::text, ''),
             E'\n' ORDER BY e.id), ''), 'UTF8')),
         v_prev, v_xmin
    FROM audit.event e
   WHERE e.tenant_id = p_tenant
     AND e.occurred_at >= p_date::timestamptz
     AND e.occurred_at <  v_cut
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION audit.seal_day(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.seal_day(uuid, date) TO jobs;

-- O selo precisa gravar a PROPRIA execucao, senao o dead man's switch abaixo
-- responde 'nunca_executou' para sempre e o alarme e desligado na primeira
-- semana. 'adiado' (55006) nao e erro e nao e sinal de vida: e um estado.
GRANT EXECUTE ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) TO jobs;

CREATE FUNCTION audit.run_seal(p_tenant uuid, p_date date) RETURNS text
LANGUAGE plpgsql
SET search_path = audit, pg_catalog AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_outcome text;
  v_detail  text;
BEGIN
  BEGIN
    PERFORM audit.seal_day(p_tenant, p_date);
    v_outcome := 'sucesso';
  EXCEPTION
    WHEN sqlstate '55006' THEN
      v_outcome := 'adiado';  v_detail := SQLERRM;
    WHEN OTHERS THEN
      v_outcome := 'erro';    v_detail := SQLERRM;
  END;

  INSERT INTO audit.seal_run
         (tenant_id, seal_date, started_at, finished_at, outcome, detail)
  VALUES (p_tenant, p_date, v_started, clock_timestamp(), v_outcome, v_detail);

  PERFORM audit.log_security(
    'SEAL_RUN',
    CASE WHEN v_outcome = 'erro' THEN 'erro' ELSE 'sucesso' END,
    'audit', 'seal', NULL, p_tenant, NULL, NULL, 'system', NULL, NULL, NULL,
    jsonb_build_object('seal_date', p_date::text, 'job_name', 'seal',
                       'reason', v_outcome));

  RETURN v_outcome;
END $$;

REVOKE ALL ON FUNCTION audit.run_seal(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.run_seal(uuid, date) TO jobs;

-- DEAD MAN'S SWITCH. O selo e a unica garantia real de imutabilidade, e job que
-- para nao faz barulho. Alarme por AUSENCIA de execucao, nao so por erro:
-- execucao que terminou em 'erro' ou 'adiado' NAO conta como sinal de vida.
CREATE FUNCTION audit.seal_watchdog(p_max_atraso interval DEFAULT interval '26 hours')
RETURNS TABLE (status text, ultima_execucao timestamptz, atraso interval)
LANGUAGE sql STABLE
SET search_path = audit, pg_catalog AS $$
  SELECT CASE
           WHEN max(r.started_at) IS NULL                          THEN 'nunca_executou'
           WHEN clock_timestamp() - max(r.started_at) > p_max_atraso THEN 'ausente'
           ELSE 'ok'
         END,
         max(r.started_at),
         clock_timestamp() - max(r.started_at)
    FROM audit.seal_run r
   WHERE r.outcome = 'sucesso';
$$;

REVOKE ALL ON FUNCTION audit.seal_watchdog(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.seal_watchdog(interval) TO jobs, app_rw;

RESET ROLE;
