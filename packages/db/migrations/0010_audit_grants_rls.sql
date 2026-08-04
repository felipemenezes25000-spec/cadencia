-- 0010_audit_grants_rls.sql
-- Privilegios e RLS da trilha. A aplicacao LE a trilha e nunca escreve nela.

SET ROLE audit_owner;

REVOKE ALL ON audit.event FROM PUBLIC, app_rw, app_owner;
GRANT USAGE ON SCHEMA audit TO app_rw;
GRANT SELECT ON audit.event TO app_rw;          -- e nada mais: sem INSERT direto

ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON audit.event AS PERMISSIVE FOR SELECT TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());

-- SEM ESTA POLICY A TRILHA NASCE MORTA: com FORCE RLS o proprio dono e filtrado,
-- e a funcao SECURITY DEFINER (que roda como audit_owner) nao conseguiria inserir.
-- Consequencia concreta: clin.finalize_encounter chama audit.log, o INSERT viola
-- a RLS, a transacao aborta e nenhum atendimento pode ser finalizado.
CREATE POLICY writer ON audit.event AS PERMISSIVE FOR INSERT TO audit_owner WITH CHECK (true);

-- Particoes: so sao alcancadas pelo pai (nao recebem GRANT nenhum), mas a regra
-- de CI varre o catalogo e exige RLS habilitada, forcada e >= 1 policy em toda
-- particao. A funcao abaixo cria a particao ja em conformidade.
CREATE FUNCTION audit.ensure_partitions(p_months int DEFAULT 6) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_from date;
  v_to   date;
  v_name text;
  v_made int := 0;
BEGIN
  FOR i IN 0 .. greatest(p_months, 1) - 1 LOOP
    v_from := (date_trunc('month', now()) + (i || ' month')::interval)::date;
    v_to   := (v_from + interval '1 month')::date;
    v_name := 'event_' || to_char(v_from, 'YYYYMM');

    IF NOT EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'audit' AND c.relname = v_name) THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.event FOR VALUES FROM (%L) TO (%L)',
        v_name, v_from, v_to);
      v_made := v_made + 1;
    END IF;

    EXECUTE format('ALTER TABLE audit.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('ALTER TABLE audit.%I FORCE  ROW LEVEL SECURITY', v_name);

    IF NOT EXISTS (SELECT 1 FROM pg_policy p
                     JOIN pg_class c ON c.oid = p.polrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'audit' AND c.relname = v_name
                      AND p.polname = 'tenant_read') THEN
      EXECUTE format(
        'CREATE POLICY tenant_read ON audit.%I AS PERMISSIVE FOR SELECT TO app_rw
           USING (tenant_id = app.current_tenant_id() AND app.is_member())', v_name);
      EXECUTE format(
        'CREATE POLICY writer ON audit.%I AS PERMISSIVE FOR INSERT TO audit_owner
           WITH CHECK (true)', v_name);
    END IF;
  END LOOP;
  RETURN v_made;
END $$;

-- Aplica a conformidade as particoes ja criadas pela 0009.
SELECT audit.ensure_partitions(6);

RESET ROLE;
