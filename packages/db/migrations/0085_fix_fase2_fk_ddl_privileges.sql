-- 0085_fix_fase2_fk_ddl_privileges.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Correcoes pos-Fase 2:
-- 1. FKs compostas faltantes (invariante 2)
-- 2. DDL lint: refresh_daily_rollup usava ::date em vez de app.local_date() (invariante 8)
-- 3. Excecao de invariante para daily_rollup.category_id (sentinel UUID na PK)

BEGIN;

--------------------------------------------------------------------
-- 1. FK composta faltante: fin.entry.professional_id → app.professional
--------------------------------------------------------------------
ALTER TABLE fin.entry
  ADD CONSTRAINT fk_entry_professional
    FOREIGN KEY (tenant_id, professional_id)
    REFERENCES app.professional(tenant_id, id);

--------------------------------------------------------------------
-- 2. FK composta faltante: fin.reconciliation_log.entry_id → fin.entry
--    entry_id e nullable (NULL para divergencias 'missing_in_system');
--    MATCH SIMPLE pula a verificacao quando entry_id IS NULL.
--------------------------------------------------------------------
ALTER TABLE fin.reconciliation_log
  ADD CONSTRAINT fk_reconciliation_entry
    FOREIGN KEY (tenant_id, entry_id)
    REFERENCES fin.entry(tenant_id, id);

--------------------------------------------------------------------
-- 3. daily_rollup.category_id usa sentinel UUID 00000000-... na PK
--    em vez de NULL (que a PK nao aceita). FK a fin.category seria
--    incorreta porque o sentinel nao existe la. Excecao declarada
--    por COMMENT conforme §3.13 regra 8.
--------------------------------------------------------------------
COMMENT ON TABLE fin.daily_rollup IS 'global-reference';

--------------------------------------------------------------------
-- 4. DDL lint: refresh_daily_rollup usava ::date (invariante 8).
--    Substitui por app.local_date(timestamptz, text).
--------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin.refresh_daily_rollup(
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
  v_timezone  text;
BEGIN
  SELECT timezone INTO v_timezone
    FROM app.clinic
   WHERE tenant_id = p_tenant_id AND id = p_clinic_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_old_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  DELETE FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

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
     AND app.local_date(e.created_at, v_timezone) = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

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
     AND app.local_date(e.paid_at, v_timezone) = p_day
   GROUP BY e.kind, COALESCE(e.category_id, '00000000-0000-0000-0000-000000000000'), e.status;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_new_total
    FROM fin.daily_rollup
   WHERE tenant_id = p_tenant_id AND clinic_id = p_clinic_id AND day = p_day;

  RETURN QUERY SELECT (v_old_total <> v_new_total), v_old_total, v_new_total;
END;
$$;

COMMIT;
