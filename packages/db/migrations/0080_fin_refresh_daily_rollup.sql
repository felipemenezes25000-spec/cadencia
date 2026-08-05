-- 0080_fin_refresh_daily_rollup.sql
-- Funcao de recalculo do rollup diario. A TABELA fin.daily_rollup ja existe
-- (migration 0078, Bloco 05). Esta migration cria apenas a funcao.

BEGIN;

--------------------------------------------------------------------
-- fin.refresh_daily_rollup — SECURITY DEFINER para o job noturno
--    Recalcula o rollup de um dia para um tenant+clinic.
--    Comparacao com SUM real detecta divergencia.
--------------------------------------------------------------------
CREATE FUNCTION fin.refresh_daily_rollup(
  p_tenant_id uuid,
  p_clinic_id uuid,
  p_day       date
) RETURNS TABLE (
  divergent boolean,
  old_total bigint,
  new_total bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, pg_catalog AS $$
DECLARE
  v_old_total bigint;
  v_new_total bigint;
BEGIN
  -- Captura o total antigo do rollup
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_old_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  -- Apaga e recalcula
  DELETE FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  -- Competencia: agrupa pela data de criacao do lancamento (created_at::date)
  INSERT INTO fin.daily_rollup (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
  SELECT p_tenant_id, p_clinic_id, p_day, 'competencia',
         e.kind,
         COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'),
         e.status::text,
         SUM(e.amount_cents),
         COUNT(*)::int
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id
     AND e.clinic_id = p_clinic_id
     AND e.created_at::date = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

  -- Caixa: agrupa pela data de pagamento (paid_at)
  INSERT INTO fin.daily_rollup (tenant_id, clinic_id, day, basis, kind, category_id, status, amount_cents, entries)
  SELECT p_tenant_id, p_clinic_id, p_day, 'caixa',
         e.kind,
         COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'),
         e.status::text,
         SUM(e.amount_cents),
         COUNT(*)::int
    FROM fin.entry e
   WHERE e.tenant_id = p_tenant_id
     AND e.clinic_id = p_clinic_id
     AND (e.paid_at AT TIME ZONE (
       SELECT timezone FROM app.clinic WHERE tenant_id = p_tenant_id AND id = p_clinic_id
     ))::date = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

  -- Captura o novo total do rollup
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_new_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  RETURN QUERY SELECT (v_old_total <> v_new_total), v_old_total, v_new_total;
END;
$$;

-- O job roda como `jobs` (BYPASSRLS), mas a funcao e SECURITY DEFINER
-- de app_owner para encapsular a logica de recalculo.
REVOKE ALL ON FUNCTION fin.refresh_daily_rollup(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin.refresh_daily_rollup(uuid, uuid, date) TO app_rw;

COMMIT;
